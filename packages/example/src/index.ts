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
const TENANT_ASSOC_PREFIX = 'tenant-assoc:';
const WORKER_ASSOC_PREFIX = 'worker-assoc:';

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

async function handleAPI(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace('/api', '');

  // Create platform with defaults
  const platform = Platform.create({
    loader: env.LOADER,
    tenantsKV: env.TENANTS,
    workersKV: env.WORKERS,
    defaults: {
      env: { ENVIRONMENT: 'development' },
      compatibilityDate: '2026-01-24',
      compatibilityFlags: ['nodejs_compat'],
      limits: { cpuMs: 50, subrequests: 50 },
    },
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
      return json({ success: true, defaults: platform.getDefaults() });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Playground endpoints (ephemeral, for testing)
    // ─────────────────────────────────────────────────────────────────────────

    // POST /api/run - Build and run code (ephemeral)
    if (path === '/run' && request.method === 'POST') {
      const { files, options, tenantId } = await request.json() as {
        files: Record<string, string>;
        options?: { bundle?: boolean; minify?: boolean };
        tenantId?: string;
      };

      const buildStart = Date.now();
      const result = await buildWorker(files, options);
      const buildTime = Date.now() - buildStart;

      // If tenantId provided, use tenant defaults; otherwise create ephemeral
      let worker;
      const loadStart = Date.now();
      
      if (tenantId) {
        // Ensure tenant exists, create if not
        let tenant = await platform.getTenant(tenantId);
        if (!tenant) {
          await platform.createTenant({ id: tenantId });
          tenant = await platform.getTenant(tenantId);
        }
        
        // Merge tenant env (ASSETS binding not supported for ephemeral workers)
        const tenantEnv = {
          ...platform.getDefaults().env,
          ...tenant?.config.env,
        };
        
        const workerName = `${tenantId}:ephemeral:${Date.now()}`;
        const worker = env.LOADER.get(workerName, async () => ({
          mainModule: result.mainModule,
          modules: result.modules as Record<string, string>,
          compatibilityDate: tenant?.config.compatibilityDate ?? platform.getDefaults().compatibilityDate ?? '2026-01-24',
          compatibilityFlags: [
            ...(platform.getDefaults().compatibilityFlags ?? []),
            ...(tenant?.config.compatibilityFlags ?? []),
          ],
          env: tenantEnv,
          limits: { ...platform.getDefaults().limits, ...tenant?.config.limits },
          globalOutbound: typedExports.OutboundHandler,
        }));
        const loadTime = Date.now() - loadStart;
        
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
            mainModule: result.mainModule,
            modules: Object.keys(result.modules),
            warnings: result.warnings ?? [],
          },
          response: {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: responseBody,
          },
          workerError,
          timing: { buildTime, loadTime, runTime, total: buildTime + loadTime + runTime },
        });
      }

      // Ephemeral without tenant (ASSETS binding not supported for ephemeral workers)
      const workerName = `ephemeral-${Date.now()}`;
      worker = env.LOADER.get(workerName, async () => ({
        mainModule: result.mainModule,
        modules: result.modules as Record<string, string>,
        compatibilityDate: '2026-01-24',
        compatibilityFlags: [],
        env: { 
          API_KEY: 'demo-key-12345', 
          DEBUG: 'true',
        },
        globalOutbound: typedExports.OutboundHandler,
      }));
      const loadTime = Date.now() - loadStart;

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
          mainModule: result.mainModule,
          modules: Object.keys(result.modules),
          warnings: result.warnings ?? [],
        },
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: responseBody,
        },
        workerError,
        timing: { buildTime, loadTime, runTime, total: buildTime + loadTime + runTime },
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
