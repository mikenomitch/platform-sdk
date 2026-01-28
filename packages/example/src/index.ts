/**
 * Platforms SDK Playground
 * 
 * A playground to test the Platforms SDK with a nice UI.
 * Shows all three layers of the SDK in action.
 */

import { Platform, buildWorker, type TenantConfig } from 'platforms-sdk';

interface Env {
  LOADER: import('platforms-sdk').WorkerLoader;
  TENANTS: KVNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const platform = Platform.fromEnv(env);

    // API Routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, url, platform, env);
    }

    // Tenant routing: /tenant/:id/*
    if (url.pathname.startsWith('/tenant/')) {
      return handleTenantRoute(request, url, platform);
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};

async function handleAPI(
  request: Request,
  url: URL,
  platform: Platform,
  env: Env
): Promise<Response> {
  const path = url.pathname.replace('/api', '');

  try {
    // POST /api/build - Build worker code without saving (for playground)
    if (path === '/build' && request.method === 'POST') {
      const { files, options } = await request.json() as {
        files: Record<string, string>;
        options?: { bundle?: boolean; minify?: boolean };
      };

      const startTime = Date.now();
      const result = await buildWorker(files, options);
      const buildTime = Date.now() - startTime;

      return json({
        success: true,
        mainModule: result.mainModule,
        modules: Object.keys(result.modules),
        warnings: result.warnings ?? [],
        timing: { buildTime },
      });
    }

    // POST /api/run - Build and run worker code (ephemeral, not saved)
    if (path === '/run' && request.method === 'POST') {
      const { files, options, testRequest } = await request.json() as {
        files: Record<string, string>;
        options?: { bundle?: boolean; minify?: boolean };
        testRequest?: { method?: string; path?: string; headers?: Record<string, string>; body?: string };
      };

      const buildStart = Date.now();
      const result = await buildWorker(files, options);
      const buildTime = Date.now() - buildStart;

      // Create ephemeral worker
      const workerName = `ephemeral-${Date.now()}`;
      const loadStart = Date.now();
      const worker = env.LOADER.get(workerName, async () => ({
        mainModule: result.mainModule,
        modules: result.modules as Record<string, string>,
        compatibilityDate: '2026-01-01',
        compatibilityFlags: [],
        env: { API_KEY: 'demo-key-12345', DEBUG: 'true' },
      }));
      const loadTime = Date.now() - loadStart;

      // Execute the worker
      const testReq = new Request(`https://tenant.local${testRequest?.path ?? '/'}`, {
        method: testRequest?.method ?? 'GET',
        headers: testRequest?.headers,
        body: testRequest?.body,
      });

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

      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      return json({
        success: !workerError,
        buildInfo: {
          mainModule: result.mainModule,
          modules: Object.keys(result.modules),
          warnings: result.warnings ?? [],
        },
        response: { status: response.status, headers, body: responseBody },
        workerError,
        timing: { buildTime, loadTime, runTime, total: buildTime + loadTime + runTime },
      });
    }

    // GET /api/tenants - List tenants
    if (path === '/tenants' && request.method === 'GET') {
      const result = await platform.listTenants({
        limit: 50,
        cursor: url.searchParams.get('cursor') ?? undefined,
      });
      return json(result);
    }

    // POST /api/tenants - Create tenant
    if (path === '/tenants' && request.method === 'POST') {
      const config = await request.json() as TenantConfig;
      const metadata = await platform.createTenant(config);
      return json({ success: true, metadata }, 201);
    }

    // GET /api/tenants/:id - Get tenant
    const tenantMatch = path.match(/^\/tenants\/([^/]+)$/);
    if (tenantMatch && request.method === 'GET') {
      const record = await platform.getTenant(tenantMatch[1]);
      if (!record) {
        return json({ error: 'Tenant not found' }, 404);
      }
      return json(record);
    }

    // PUT /api/tenants/:id - Update tenant
    if (tenantMatch && request.method === 'PUT') {
      const updates = await request.json() as Partial<TenantConfig>;
      const metadata = await platform.updateTenant(tenantMatch[1], updates);
      return json({ success: true, metadata });
    }

    // DELETE /api/tenants/:id - Delete tenant
    if (tenantMatch && request.method === 'DELETE') {
      const deleted = await platform.deleteTenant(tenantMatch[1]);
      return json({ success: deleted });
    }

    // POST /api/tenants/:id/execute - Execute tenant worker
    const executeMatch = path.match(/^\/tenants\/([^/]+)\/execute$/);
    if (executeMatch && request.method === 'POST') {
      const { method, path: reqPath, headers, body } = await request.json() as {
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        body?: string;
      };

      const response = await platform.execute(executeMatch[1], {
        method,
        path: reqPath,
        headers,
        body,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      return json({
        status: response.status,
        headers: responseHeaders,
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

async function handleTenantRoute(
  request: Request,
  url: URL,
  platform: Platform
): Promise<Response> {
  // Extract tenant ID from path: /tenant/:id/...
  const match = url.pathname.match(/^\/tenant\/([^/]+)(\/.*)?$/);
  if (!match) {
    return json({ error: 'Invalid tenant route' }, 400);
  }

  const tenantId = match[1];
  const path = match[2] ?? '/';

  // Rewrite request to remove tenant prefix
  const tenantUrl = new URL(request.url);
  tenantUrl.pathname = path;
  const tenantRequest = new Request(tenantUrl.toString(), request);

  try {
    return await platform.routeRequest(tenantId, tenantRequest);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return json({ error: 'Tenant not found' }, 404);
    }
    throw err;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
