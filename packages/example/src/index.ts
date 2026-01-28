/**
 * Platforms SDK Playground
 */

import { WorkerEntrypoint, exports } from 'cloudflare:workers';
import { Platform, buildWorker } from 'platforms-sdk';

interface Env {
  LOADER: import('platforms-sdk').WorkerLoader;
  TENANTS: KVNamespace;
  WORKERS: KVNamespace;
  ASSETS: Fetcher;
}

/**
 * Outbound handler - intercepts all fetch() calls from tenant workers
 */
export class OutboundHandler extends WorkerEntrypoint {
  async fetch(request: Request) {
    console.log(`[Outbound] ${request.method} ${request.url}`);
    return fetch(request);
  }
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
        const tenant = await platform.getTenant(tenantId);
        if (!tenant) {
          await platform.createTenant({ id: tenantId });
        }
        
        // Run with tenant defaults
        const testReq = new Request('https://tenant.local/', { method: 'GET' });
        const response = await platform.runEphemeral(tenantId, files, testReq, { build: options });
        const loadTime = Date.now() - loadStart;
        const responseBody = await response.text();

        return json({
          success: true,
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
          timing: { buildTime, loadTime, runTime: 0, total: buildTime + loadTime },
        });
      }

      // Ephemeral without tenant
      const workerName = `ephemeral-${Date.now()}`;
      worker = env.LOADER.get(workerName, async () => ({
        mainModule: result.mainModule,
        modules: result.modules as Record<string, string>,
        compatibilityDate: '2026-01-24',
        compatibilityFlags: [],
        env: { API_KEY: 'demo-key-12345', DEBUG: 'true' },
        // globalOutbound: exports.OutboundHandler(), // Uncomment to enable
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
        return json(record);
      }

      if (request.method === 'PUT') {
        const updates = await request.json() as Partial<import('platforms-sdk').TenantConfig>;
        const metadata = await platform.updateTenant(tenantId, updates);
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
      const config = await request.json() as Omit<import('platforms-sdk').WorkerConfig, 'tenantId'>;
      const metadata = await platform.createWorker(workersMatch[1], config);
      return json({ success: true, metadata }, 201);
    }

    // Worker by ID routes
    const workerMatch = path.match(/^\/tenants\/([^/]+)\/workers\/([^/]+)$/);
    if (workerMatch) {
      const [, tenantId, workerId] = workerMatch;

      if (request.method === 'GET') {
        const record = await platform.getWorker(tenantId, workerId);
        if (!record) return json({ error: 'Worker not found' }, 404);
        return json(record);
      }

      if (request.method === 'PUT') {
        const updates = await request.json() as Partial<import('platforms-sdk').WorkerConfig>;
        const metadata = await platform.updateWorker(tenantId, workerId, updates);
        return json({ success: true, metadata });
      }

      if (request.method === 'DELETE') {
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
