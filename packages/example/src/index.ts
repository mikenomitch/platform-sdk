/**
 * Platforms SDK Playground
 */

import { WorkerEntrypoint, exports } from 'cloudflare:workers';

// Type assertion for exports - cloudflare:workers exports includes our OutboundHandler
// The export is already a Fetcher (loopback stub), not a function
const typedExports = exports as unknown as {
  OutboundHandler: Fetcher;
};
import { Platform, buildWorker } from 'platforms-sdk';

interface Env {
  LOADER: import('platforms-sdk').WorkerLoader;
  TENANTS: KVNamespace;
  WORKERS: KVNamespace;
  ASSETS: Fetcher;
}

// Cached bundle for ephemeral workers (stored in KV)
interface EphemeralBundle {
  mainModule: string;
  modules: Record<string, string>;
  builtAt: string;
}

// Hash files to create a cache key for ephemeral bundles
async function hashFiles(files: Record<string, string>): Promise<string> {
  const content = JSON.stringify(files, Object.keys(files).sort());
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const EPHEMERAL_BUNDLE_PREFIX = 'ephemeral-bundle:';

// Types for outbound/tail worker definitions stored in KV
interface OutboundWorkerConfig {
  id: string;
  name: string;
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface TailWorkerConfig {
  id: string;
  name: string;
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// Worker template definitions
interface TemplateSlot {
  name: string;
  description: string;
  defaultValue: string;
}

interface WorkerTemplate {
  id: string;
  name: string;
  description: string;
  slots: TemplateSlot[];
  files: Record<string, string>; // Files with {{slotName}} placeholders
  createdAt: string;
  updatedAt: string;
}

// Default outbound worker that blocks all except zombo.com
const DEFAULT_OUTBOUND_FILES: Record<string, string> = {
  'src/index.ts': `import { WorkerEntrypoint } from 'cloudflare:workers';

export class OutboundHandler extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Only allow requests to zombo.com
    if (url.hostname === 'zombo.com' || url.hostname.endsWith('.zombo.com')) {
      console.log('[Outbound] Allowed:', request.method, request.url);
      return fetch(request);
    }
    
    // Block everything else
    console.log('[Outbound] Blocked:', request.method, request.url);
    return new Response('no no - outbound requests are only allowed to zombo.com', { 
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

export default {
  fetch() {
    return new Response('Outbound worker - use via binding');
  }
}`,
  'package.json': JSON.stringify({ name: 'default-outbound', main: 'src/index.ts' }, null, 2),
};

// Default tail worker that logs custom messages
const DEFAULT_TAIL_FILES: Record<string, string> = {
  'src/index.ts': `export default {
  async tail(events: TraceItem[]): Promise<void> {
    for (const event of events) {
      console.log('[TailWorker] Custom Log -', {
        scriptName: event.scriptName,
        outcome: event.outcome,
        eventTimestamp: event.eventTimestamp,
        logs: event.logs?.length ?? 0,
        exceptions: event.exceptions?.length ?? 0,
      });
      
      // Log any exceptions
      if (event.exceptions?.length) {
        for (const ex of event.exceptions) {
          console.error('[TailWorker] Exception:', ex.name, ex.message);
        }
      }
    }
  }
}`,
  'package.json': JSON.stringify({ name: 'default-tail', main: 'src/index.ts' }, null, 2),
};

/**
 * Outbound handler - intercepts all fetch() calls from tenant workers
 * Blocks all requests except to allowed domains (zombo.com for demo purposes)
 */
export class OutboundHandler extends WorkerEntrypoint {
  async fetch(request: Request) {
    const url = new URL(request.url);
    
    // Allow requests to zombo.com (demo easter egg)
    if (url.hostname === 'zombo.com' || url.hostname.endsWith('.zombo.com')) {
      console.log(`[Outbound] Allowed: ${request.method} ${request.url}`);
      return fetch(request);
    }
    
    // Block everything else
    console.log(`[Outbound] Blocked: ${request.method} ${request.url}`);
    return new Response(
      JSON.stringify({
        error: 'Outbound request blocked',
        message: 'Subrequests are only allowed to zombo.com in this demo',
        blocked_url: request.url,
      }, null, 2),
      { 
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Note: ASSETS binding is not supported for ephemeral workers in the playground
// because functions cannot be cloned across isolate boundaries.
// The static-site and fullstack examples will show an error if they try to use env.ASSETS.

// KV key prefixes for outbound and tail workers
const OUTBOUND_PREFIX = 'outbound:';
const TAIL_PREFIX = 'tail:';
const TEMPLATE_PREFIX = 'template:';
const TENANT_ASSOC_PREFIX = 'tenant-assoc:';
const WORKER_ASSOC_PREFIX = 'worker-assoc:';

// Default math worker template
const DEFAULT_MATH_TEMPLATE: WorkerTemplate = {
  id: 'math-calculator',
  name: 'Math Calculator',
  description: 'A simple worker that performs math operations and returns the result. Use the pre-defined add(), subtract(), multiply(), and divide() functions.',
  slots: [
    {
      name: 'calculation',
      description: 'The math expression to evaluate using add(), subtract(), multiply(), divide() functions',
      defaultValue: 'add(multiply(2, 3), subtract(10, 5))',
    },
  ],
  files: {
    'src/index.ts': `// Math Calculator Worker
// Uses pre-defined math functions to compute a result

function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

export default {
  fetch(request: Request): Response {
    const result = {{calculation}};
    
    return new Response(JSON.stringify({ result }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}`,
    'package.json': JSON.stringify({ name: 'math-calculator', main: 'src/index.ts' }, null, 2),
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Association types - what outbound/tail workers are attached to a tenant or worker
interface TenantAssociations {
  outboundWorkerId?: string;
  tailWorkerIds?: string[];
}

interface WorkerAssociations {
  outboundWorkerId?: string;
  tailWorkerIds?: string[];
}

// Helper to get/put outbound workers
async function getOutboundWorker(kv: KVNamespace, id: string): Promise<OutboundWorkerConfig | null> {
  const data = await kv.get(OUTBOUND_PREFIX + id);
  return data ? JSON.parse(data) : null;
}

async function putOutboundWorker(kv: KVNamespace, config: OutboundWorkerConfig): Promise<void> {
  await kv.put(OUTBOUND_PREFIX + config.id, JSON.stringify(config));
}

async function deleteOutboundWorker(kv: KVNamespace, id: string): Promise<boolean> {
  const existing = await getOutboundWorker(kv, id);
  if (!existing) return false;
  await kv.delete(OUTBOUND_PREFIX + id);
  return true;
}

async function listOutboundWorkers(kv: KVNamespace): Promise<OutboundWorkerConfig[]> {
  const list = await kv.list({ prefix: OUTBOUND_PREFIX });
  const results: OutboundWorkerConfig[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) results.push(JSON.parse(data));
  }
  return results;
}

// Helper to get/put tail workers
async function getTailWorker(kv: KVNamespace, id: string): Promise<TailWorkerConfig | null> {
  const data = await kv.get(TAIL_PREFIX + id);
  return data ? JSON.parse(data) : null;
}

async function putTailWorker(kv: KVNamespace, config: TailWorkerConfig): Promise<void> {
  await kv.put(TAIL_PREFIX + config.id, JSON.stringify(config));
}

async function deleteTailWorker(kv: KVNamespace, id: string): Promise<boolean> {
  const existing = await getTailWorker(kv, id);
  if (!existing) return false;
  await kv.delete(TAIL_PREFIX + id);
  return true;
}

async function listTailWorkers(kv: KVNamespace): Promise<TailWorkerConfig[]> {
  const list = await kv.list({ prefix: TAIL_PREFIX });
  const results: TailWorkerConfig[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) results.push(JSON.parse(data));
  }
  return results;
}

// Helper to get/put templates
async function getTemplate(kv: KVNamespace, id: string): Promise<WorkerTemplate | null> {
  const data = await kv.get(TEMPLATE_PREFIX + id);
  return data ? JSON.parse(data) : null;
}

async function putTemplate(kv: KVNamespace, template: WorkerTemplate): Promise<void> {
  await kv.put(TEMPLATE_PREFIX + template.id, JSON.stringify(template));
}

async function deleteTemplate(kv: KVNamespace, id: string): Promise<boolean> {
  const existing = await getTemplate(kv, id);
  if (!existing) return false;
  await kv.delete(TEMPLATE_PREFIX + id);
  return true;
}

async function listTemplates(kv: KVNamespace): Promise<WorkerTemplate[]> {
  const list = await kv.list({ prefix: TEMPLATE_PREFIX });
  const results: WorkerTemplate[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) results.push(JSON.parse(data));
  }
  return results;
}

// Apply slot values to template files
function applyTemplateSlots(files: Record<string, string>, slotValues: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [filename, content] of Object.entries(files)) {
    let processed = content;
    for (const [slotName, value] of Object.entries(slotValues)) {
      processed = processed.replace(new RegExp(`\\{\\{${slotName}\\}\\}`, 'g'), value);
    }
    result[filename] = processed;
  }
  return result;
}

// Build and get a stub for an outbound worker
async function getOutboundStub(
  loader: import('platforms-sdk').WorkerLoader,
  config: OutboundWorkerConfig
): Promise<Fetcher> {
  const result = await buildWorker(config.files);
  const stub = loader.get(`outbound:${config.id}`, async () => ({
    mainModule: result.mainModule,
    modules: result.modules as Record<string, string>,
    compatibilityDate: '2026-01-24',
    compatibilityFlags: [],
  }));
  return stub.getEntrypoint('OutboundHandler');
}

// Build and get a reference for a tail worker
async function getTailStub(
  loader: import('platforms-sdk').WorkerLoader,
  config: TailWorkerConfig
): Promise<unknown> {
  const result = await buildWorker(config.files);
  const stub = loader.get(`tail:${config.id}`, async () => ({
    mainModule: result.mainModule,
    modules: result.modules as Record<string, string>,
    compatibilityDate: '2026-01-24',
    compatibilityFlags: [],
  }));
  return stub;
}

// Association helpers
async function getTenantAssociations(kv: KVNamespace, tenantId: string): Promise<TenantAssociations> {
  const data = await kv.get(TENANT_ASSOC_PREFIX + tenantId);
  return data ? JSON.parse(data) : {};
}

async function putTenantAssociations(kv: KVNamespace, tenantId: string, assoc: TenantAssociations): Promise<void> {
  await kv.put(TENANT_ASSOC_PREFIX + tenantId, JSON.stringify(assoc));
}

async function getWorkerAssociations(kv: KVNamespace, tenantId: string, workerId: string): Promise<WorkerAssociations> {
  const data = await kv.get(WORKER_ASSOC_PREFIX + `${tenantId}:${workerId}`);
  return data ? JSON.parse(data) : {};
}

async function putWorkerAssociations(kv: KVNamespace, tenantId: string, workerId: string, assoc: WorkerAssociations): Promise<void> {
  await kv.put(WORKER_ASSOC_PREFIX + `${tenantId}:${workerId}`, JSON.stringify(assoc));
}

async function deleteWorkerAssociations(kv: KVNamespace, tenantId: string, workerId: string): Promise<void> {
  await kv.delete(WORKER_ASSOC_PREFIX + `${tenantId}:${workerId}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API Routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, url, env);
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};

const PLATFORM_DEFAULTS_KEY = 'platform-defaults';

const DEFAULT_PLATFORM_DEFAULTS: import('platforms-sdk').WorkerDefaults = {
  env: { ENVIRONMENT: 'development' },
  compatibilityDate: '2026-01-24',
  compatibilityFlags: ['nodejs_compat'],
  limits: { cpuMs: 50, subrequests: 50 },
};

async function getPlatformDefaults(kv: KVNamespace): Promise<import('platforms-sdk').WorkerDefaults> {
  const stored = await kv.get<import('platforms-sdk').WorkerDefaults>(PLATFORM_DEFAULTS_KEY, 'json');
  return stored ?? DEFAULT_PLATFORM_DEFAULTS;
}

async function savePlatformDefaults(kv: KVNamespace, defaults: import('platforms-sdk').WorkerDefaults): Promise<void> {
  await kv.put(PLATFORM_DEFAULTS_KEY, JSON.stringify(defaults));
}

async function handleAPI(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace('/api', '');

  // Load persisted defaults from KV
  const storedDefaults = await getPlatformDefaults(env.WORKERS);

  // Create platform with persisted defaults
  const platform = Platform.create({
    loader: env.LOADER,
    tenantsKV: env.TENANTS,
    workersKV: env.WORKERS,
    defaults: storedDefaults,
    // outbound: exports.OutboundHandler(), // Uncomment to enable outbound interception
  });

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Platform defaults
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/defaults
    if (path === '/defaults' && request.method === 'GET') {
      return json(platform.getDefaults());
    }

    // PUT /api/defaults
    if (path === '/defaults' && request.method === 'PUT') {
      const updates = await request.json() as Partial<import('platforms-sdk').WorkerDefaults>;
      platform.updateDefaults(updates);
      const newDefaults = platform.getDefaults();
      await savePlatformDefaults(env.WORKERS, newDefaults);
      return json({ success: true, defaults: newDefaults });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Playground endpoints (ephemeral, for testing)
    // ─────────────────────────────────────────────────────────────────────────

    // POST /api/run - Build and run code (ephemeral, with caching)
    if (path === '/run' && request.method === 'POST') {
      const { files, options, tenantId } = await request.json() as {
        files: Record<string, string>;
        options?: { bundle?: boolean; minify?: boolean };
        tenantId?: string;
      };

      // Hash files to create a stable cache key
      const filesHash = await hashFiles(files);
      const cacheKey = EPHEMERAL_BUNDLE_PREFIX + filesHash;
      
      // Check if we have a cached bundle
      let mainModule: string;
      let modules: Record<string, string>;
      let buildTime = 0;
      let cacheHit = false;
      
      const cachedBundle = await env.WORKERS.get<EphemeralBundle>(cacheKey, 'json');
      if (cachedBundle) {
        // Use cached bundle
        mainModule = cachedBundle.mainModule;
        modules = cachedBundle.modules;
        cacheHit = true;
      } else {
        // Build and cache
        const buildStart = Date.now();
        const result = await buildWorker(files, options);
        buildTime = Date.now() - buildStart;
        
        mainModule = result.mainModule;
        modules = result.modules as Record<string, string>;
        
        // Store in KV for future requests (TTL: 1 hour)
        const bundle: EphemeralBundle = {
          mainModule,
          modules,
          builtAt: new Date().toISOString(),
        };
        await env.WORKERS.put(cacheKey, JSON.stringify(bundle), { expirationTtl: 3600 });
      }

      // Load worker - use hash as the worker name so loader can cache it too
      const loadStart = Date.now();
      const workerName = tenantId ? `${tenantId}:playground:${filesHash}` : `playground:${filesHash}`;
      
      // Get tenant config if provided
      let tenantEnv: Record<string, unknown> = { 
        API_KEY: 'demo-key-12345', 
        DEBUG: 'true',
        ENVIRONMENT: 'development',
      };
      let compatDate = '2026-01-24';
      let compatFlags: string[] = ['nodejs_compat'];
      let limits: { cpuMs?: number; subrequests?: number } | undefined = { cpuMs: 50, subrequests: 50 };
      
      if (tenantId) {
        let tenant = await platform.getTenant(tenantId);
        if (!tenant) {
          await platform.createTenant({ id: tenantId });
          tenant = await platform.getTenant(tenantId);
        }
        if (tenant) {
          tenantEnv = {
            ...platform.getDefaults().env,
            ...tenant.config.env,
          };
          compatDate = tenant.config.compatibilityDate ?? platform.getDefaults().compatibilityDate ?? '2026-01-24';
          compatFlags = [
            ...(platform.getDefaults().compatibilityFlags ?? []),
            ...(tenant.config.compatibilityFlags ?? []),
          ];
          limits = { ...platform.getDefaults().limits, ...tenant.config.limits };
        }
      }
      
      // The loader callback only runs on cold starts - it fetches the cached bundle
      const workersKV = env.WORKERS;
      const worker = env.LOADER.get(workerName, async () => {
        // On cold start, fetch from KV (fast) instead of rebuilding (slow)
        const bundle = await workersKV.get<EphemeralBundle>(cacheKey, 'json');
        if (!bundle) {
          throw new Error(`Bundle not found for hash ${filesHash}`);
        }
        return {
          mainModule: bundle.mainModule,
          modules: bundle.modules,
          compatibilityDate: compatDate,
          compatibilityFlags: compatFlags,
          env: tenantEnv,
          limits,
          globalOutbound: typedExports.OutboundHandler,
        };
      });
      const loadTime = Date.now() - loadStart;
      
      // Execute the worker
      const testReq = new Request('https://tenant.local/', { method: 'GET' });
      const runStart = Date.now();
      let response: Response;
      let responseBody: string;
      let workerError: { message: string; stack?: string } | null = null;

      try {
        response = await worker.getEntrypoint().fetch(testReq);
        responseBody = await response.text();
        if (response.status >= 500 && responseBody === 'Internal Server Error') {
          workerError = { message: 'Worker threw an uncaught exception' };
        }
      } catch (err) {
        workerError = {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        };
        response = new Response('', { status: 500 });
        responseBody = '';
      }
      const runTime = Date.now() - runStart;

      return json({
        success: !workerError,
        buildInfo: {
          mainModule,
          modules: Object.keys(modules),
          warnings: [],
          cached: cacheHit,
        },
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: responseBody,
        },
        workerError,
        timing: { 
          buildTime: cacheHit ? 0 : buildTime,
          loadTime, 
          runTime, 
          total: (cacheHit ? 0 : buildTime) + loadTime + runTime,
          cached: cacheHit,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tenant CRUD
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/tenants
    if (path === '/tenants' && request.method === 'GET') {
      const result = await platform.listTenants({
        limit: 50,
        cursor: url.searchParams.get('cursor') ?? undefined,
      });
      return json(result);
    }

    // POST /api/tenants
    if (path === '/tenants' && request.method === 'POST') {
      const config = await request.json() as import('platforms-sdk').TenantConfig;
      const metadata = await platform.createTenant(config);
      return json({ success: true, metadata }, 201);
    }

    // Tenant by ID routes
    const tenantMatch = path.match(/^\/tenants\/([^/]+)$/);
    if (tenantMatch) {
      const tenantId = tenantMatch[1];

      if (request.method === 'GET') {
        const record = await platform.getTenant(tenantId);
        if (!record) return json({ error: 'Tenant not found' }, 404);
        const associations = await getTenantAssociations(env.WORKERS, tenantId);
        return json({ ...record, associations });
      }

      if (request.method === 'PUT') {
        const { outboundWorkerId, tailWorkerIds, ...updates } = await request.json() as 
          Partial<import('platforms-sdk').TenantConfig> & TenantAssociations;
        
        // Update tenant config
        const metadata = await platform.updateTenant(tenantId, updates);
        
        // Update associations if provided
        if (outboundWorkerId !== undefined || tailWorkerIds !== undefined) {
          const existingAssoc = await getTenantAssociations(env.WORKERS, tenantId);
          await putTenantAssociations(env.WORKERS, tenantId, {
            outboundWorkerId: outboundWorkerId ?? existingAssoc.outboundWorkerId,
            tailWorkerIds: tailWorkerIds ?? existingAssoc.tailWorkerIds,
          });
        }
        
        return json({ success: true, metadata });
      }

      if (request.method === 'DELETE') {
        const deleted = await platform.deleteTenant(tenantId);
        return json({ success: deleted });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Worker CRUD
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/tenants/:id/workers
    const workersMatch = path.match(/^\/tenants\/([^/]+)\/workers$/);
    if (workersMatch && request.method === 'GET') {
      const result = await platform.listWorkers(workersMatch[1], {
        limit: 50,
        cursor: url.searchParams.get('cursor') ?? undefined,
      });
      return json(result);
    }

    // POST /api/tenants/:id/workers
    if (workersMatch && request.method === 'POST') {
      const { outboundWorkerId, tailWorkerIds, ...config } = await request.json() as 
        Omit<import('platforms-sdk').WorkerConfig, 'tenantId'> & WorkerAssociations;
      
      console.log('[DEBUG] POST /api/tenants/:id/workers - config:', JSON.stringify(config, null, 2));
      console.log('[DEBUG] POST /api/tenants/:id/workers - files keys:', Object.keys(config.files || {}));
      
      const tenantId = workersMatch[1];
      const metadata = await platform.createWorker(tenantId, config);
      
      // Save associations if provided
      if (outboundWorkerId || tailWorkerIds?.length) {
        await putWorkerAssociations(env.WORKERS, tenantId, config.id, {
          outboundWorkerId,
          tailWorkerIds,
        });
      }
      
      return json({ success: true, metadata }, 201);
    }

    // Worker by ID routes
    const workerMatch = path.match(/^\/tenants\/([^/]+)\/workers\/([^/]+)$/);
    if (workerMatch) {
      const [, tenantId, workerId] = workerMatch;

      if (request.method === 'GET') {
        const record = await platform.getWorker(tenantId, workerId);
        if (!record) return json({ error: 'Worker not found' }, 404);
        const associations = await getWorkerAssociations(env.WORKERS, tenantId, workerId);
        return json({ ...record, associations });
      }

      if (request.method === 'PUT') {
        const { outboundWorkerId, tailWorkerIds, ...updates } = await request.json() as 
          Partial<import('platforms-sdk').WorkerConfig> & WorkerAssociations;
        
        const metadata = await platform.updateWorker(tenantId, workerId, updates);
        
        // Update associations if provided
        if (outboundWorkerId !== undefined || tailWorkerIds !== undefined) {
          const existingAssoc = await getWorkerAssociations(env.WORKERS, tenantId, workerId);
          await putWorkerAssociations(env.WORKERS, tenantId, workerId, {
            outboundWorkerId: outboundWorkerId ?? existingAssoc.outboundWorkerId,
            tailWorkerIds: tailWorkerIds ?? existingAssoc.tailWorkerIds,
          });
        }
        
        return json({ success: true, metadata });
      }

      if (request.method === 'DELETE') {
        await deleteWorkerAssociations(env.WORKERS, tenantId, workerId);
        const deleted = await platform.deleteWorker(tenantId, workerId);
        return json({ success: deleted });
      }
    }

    // POST /api/tenants/:id/workers/:workerId/fetch - Execute worker
    const fetchMatch = path.match(/^\/tenants\/([^/]+)\/workers\/([^/]+)\/fetch$/);
    if (fetchMatch && request.method === 'POST') {
      const [, tenantId, workerId] = fetchMatch;
      const { method, path: reqPath, headers, body } = await request.json() as {
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        body?: string;
      };

      const testReq = new Request(`https://worker.local${reqPath ?? '/'}`, {
        method: method ?? 'GET',
        headers,
        body,
      });

      const response = await platform.fetch(tenantId, workerId, testReq);
      return json({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Outbound Workers CRUD
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/outbound-workers
    if (path === '/outbound-workers' && request.method === 'GET') {
      const workers = await listOutboundWorkers(env.WORKERS);
      return json({ workers });
    }

    // POST /api/outbound-workers
    if (path === '/outbound-workers' && request.method === 'POST') {
      const { id, name, files } = await request.json() as { id: string; name: string; files: Record<string, string> };
      
      // Validate
      if (!id || !name || !files) {
        return json({ error: 'Missing required fields: id, name, files' }, 400);
      }
      
      // Check if exists
      const existing = await getOutboundWorker(env.WORKERS, id);
      if (existing) {
        return json({ error: `Outbound worker "${id}" already exists` }, 409);
      }
      
      // Validate it compiles
      await buildWorker(files);
      
      const now = new Date().toISOString();
      const config: OutboundWorkerConfig = { id, name, files, createdAt: now, updatedAt: now };
      await putOutboundWorker(env.WORKERS, config);
      return json({ success: true, config }, 201);
    }

    // GET/PUT/DELETE /api/outbound-workers/:id
    const outboundMatch = path.match(/^\/outbound-workers\/([^/]+)$/);
    if (outboundMatch) {
      const id = outboundMatch[1];
      
      if (request.method === 'GET') {
        const config = await getOutboundWorker(env.WORKERS, id);
        if (!config) return json({ error: 'Outbound worker not found' }, 404);
        return json(config);
      }
      
      if (request.method === 'PUT') {
        const existing = await getOutboundWorker(env.WORKERS, id);
        if (!existing) return json({ error: 'Outbound worker not found' }, 404);
        
        const updates = await request.json() as Partial<OutboundWorkerConfig>;
        if (updates.files) await buildWorker(updates.files);
        
        const config: OutboundWorkerConfig = {
          ...existing,
          ...updates,
          id, // Can't change ID
          updatedAt: new Date().toISOString(),
        };
        await putOutboundWorker(env.WORKERS, config);
        return json({ success: true, config });
      }
      
      if (request.method === 'DELETE') {
        const deleted = await deleteOutboundWorker(env.WORKERS, id);
        return json({ success: deleted });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tail Workers CRUD
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/tail-workers
    if (path === '/tail-workers' && request.method === 'GET') {
      const workers = await listTailWorkers(env.WORKERS);
      return json({ workers });
    }

    // POST /api/tail-workers
    if (path === '/tail-workers' && request.method === 'POST') {
      const { id, name, files } = await request.json() as { id: string; name: string; files: Record<string, string> };
      
      // Validate
      if (!id || !name || !files) {
        return json({ error: 'Missing required fields: id, name, files' }, 400);
      }
      
      // Check if exists
      const existing = await getTailWorker(env.WORKERS, id);
      if (existing) {
        return json({ error: `Tail worker "${id}" already exists` }, 409);
      }
      
      // Validate it compiles
      await buildWorker(files);
      
      const now = new Date().toISOString();
      const config: TailWorkerConfig = { id, name, files, createdAt: now, updatedAt: now };
      await putTailWorker(env.WORKERS, config);
      return json({ success: true, config }, 201);
    }

    // GET/PUT/DELETE /api/tail-workers/:id
    const tailMatch = path.match(/^\/tail-workers\/([^/]+)$/);
    if (tailMatch) {
      const id = tailMatch[1];
      
      if (request.method === 'GET') {
        const config = await getTailWorker(env.WORKERS, id);
        if (!config) return json({ error: 'Tail worker not found' }, 404);
        return json(config);
      }
      
      if (request.method === 'PUT') {
        const existing = await getTailWorker(env.WORKERS, id);
        if (!existing) return json({ error: 'Tail worker not found' }, 404);
        
        const updates = await request.json() as Partial<TailWorkerConfig>;
        if (updates.files) await buildWorker(updates.files);
        
        const config: TailWorkerConfig = {
          ...existing,
          ...updates,
          id, // Can't change ID
          updatedAt: new Date().toISOString(),
        };
        await putTailWorker(env.WORKERS, config);
        return json({ success: true, config });
      }
      
      if (request.method === 'DELETE') {
        const deleted = await deleteTailWorker(env.WORKERS, id);
        return json({ success: deleted });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Default Outbound/Tail Workers (create if not exists)
    // ─────────────────────────────────────────────────────────────────────────

    // POST /api/outbound-workers/create-default
    if (path === '/outbound-workers/create-default' && request.method === 'POST') {
      const existing = await getOutboundWorker(env.WORKERS, 'default');
      if (existing) {
        return json({ success: true, config: existing, message: 'Default outbound worker already exists' });
      }
      
      const now = new Date().toISOString();
      const config: OutboundWorkerConfig = {
        id: 'default',
        name: 'Default Outbound',
        files: DEFAULT_OUTBOUND_FILES,
        createdAt: now,
        updatedAt: now,
      };
      await putOutboundWorker(env.WORKERS, config);
      return json({ success: true, config }, 201);
    }

    // POST /api/tail-workers/create-default
    if (path === '/tail-workers/create-default' && request.method === 'POST') {
      const existing = await getTailWorker(env.WORKERS, 'default');
      if (existing) {
        return json({ success: true, config: existing, message: 'Default tail worker already exists' });
      }
      
      const now = new Date().toISOString();
      const config: TailWorkerConfig = {
        id: 'default',
        name: 'Default Tail (Custom Logger)',
        files: DEFAULT_TAIL_FILES,
        createdAt: now,
        updatedAt: now,
      };
      await putTailWorker(env.WORKERS, config);
      return json({ success: true, config }, 201);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Worker Templates CRUD
    // ─────────────────────────────────────────────────────────────────────────

    // GET /api/templates
    if (path === '/templates' && request.method === 'GET') {
      const templates = await listTemplates(env.WORKERS);
      return json({ templates });
    }

    // POST /api/templates
    if (path === '/templates' && request.method === 'POST') {
      const { id, name, description, slots, files } = await request.json() as {
        id: string;
        name: string;
        description: string;
        slots: TemplateSlot[];
        files: Record<string, string>;
      };
      
      if (!id || !name || !files) {
        return json({ error: 'Missing required fields: id, name, files' }, 400);
      }
      
      const existing = await getTemplate(env.WORKERS, id);
      if (existing) {
        return json({ error: `Template "${id}" already exists` }, 409);
      }
      
      const now = new Date().toISOString();
      const template: WorkerTemplate = {
        id,
        name,
        description: description || '',
        slots: slots || [],
        files,
        createdAt: now,
        updatedAt: now,
      };
      await putTemplate(env.WORKERS, template);
      return json({ success: true, template }, 201);
    }

    // GET/PUT/DELETE /api/templates/:id
    const templateMatch = path.match(/^\/templates\/([^/]+)$/);
    if (templateMatch) {
      const id = templateMatch[1];
      
      if (request.method === 'GET') {
        const template = await getTemplate(env.WORKERS, id);
        if (!template) return json({ error: 'Template not found' }, 404);
        return json(template);
      }
      
      if (request.method === 'PUT') {
        const existing = await getTemplate(env.WORKERS, id);
        if (!existing) return json({ error: 'Template not found' }, 404);
        
        const updates = await request.json() as Partial<WorkerTemplate>;
        const template: WorkerTemplate = {
          ...existing,
          ...updates,
          id, // Can't change ID
          updatedAt: new Date().toISOString(),
        };
        await putTemplate(env.WORKERS, template);
        return json({ success: true, template });
      }
      
      if (request.method === 'DELETE') {
        const deleted = await deleteTemplate(env.WORKERS, id);
        return json({ success: deleted });
      }
    }

    // POST /api/templates/create-default
    if (path === '/templates/create-default' && request.method === 'POST') {
      const existing = await getTemplate(env.WORKERS, 'math-calculator');
      if (existing) {
        return json({ success: true, template: existing, message: 'Default template already exists' });
      }
      
      await putTemplate(env.WORKERS, DEFAULT_MATH_TEMPLATE);
      return json({ success: true, template: DEFAULT_MATH_TEMPLATE }, 201);
    }

    // POST /api/templates/:id/generate - Generate worker files from template
    const generateMatch = path.match(/^\/templates\/([^/]+)\/generate$/);
    if (generateMatch && request.method === 'POST') {
      const id = generateMatch[1];
      const template = await getTemplate(env.WORKERS, id);
      if (!template) return json({ error: 'Template not found' }, 404);
      
      const { slotValues } = await request.json() as { slotValues: Record<string, string> };
      console.log('[DEBUG] POST /api/templates/:id/generate - slotValues:', slotValues);
      console.log('[DEBUG] POST /api/templates/:id/generate - template.files:', Object.keys(template.files));
      
      // Fill in default values for any missing slots
      const finalSlotValues: Record<string, string> = {};
      for (const slot of template.slots) {
        finalSlotValues[slot.name] = slotValues?.[slot.name] ?? slot.defaultValue;
      }
      
      const generatedFiles = applyTemplateSlots(template.files, finalSlotValues);
      console.log('[DEBUG] POST /api/templates/:id/generate - generatedFiles:', Object.keys(generatedFiles));
      return json({ success: true, files: generatedFiles, slotValues: finalSlotValues });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('API Error:', err);
    return json({
      error: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
    }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
