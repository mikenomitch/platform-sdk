# Platforms SDK

Build platforms on Cloudflare Workers using [Dynamic Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (Worker Loader binding).

## Why Dynamic Workers?

Workers for Platforms (WFP) provides a managed experience, but sometimes you need more control. Dynamic Workers give you:

- **Full control** - No wrappers, no abstractions you can't see through
- **Local dev works** - `wrangler dev` just works
- **Your API** - Build the exact API surface your customers need
- **Escape hatches** - Need smart placement? OTEL? Custom billing? Just do it.

This SDK follows an "onion" architecture: start with the managed layer for the 80% case, unwrap layers when you need control.

## Quick Start

```bash
npm install platforms-sdk
```

```ts
import { Platform } from 'platforms-sdk';

export default {
  async fetch(request: Request, env: Env) {
    const platform = Platform.fromEnv(env);
    
    // Create a tenant worker
    await platform.createTenant({
      id: 'my-tenant',
      files: {
        'src/index.ts': `export default { fetch: () => new Response('Hello!') }`,
      },
    });
    
    // Route requests to tenant
    return platform.routeRequest('my-tenant', request);
  }
}
```

Configure your `wrangler.toml`:

```toml
[[worker_loaders]]
binding = "LOADER"

[[kv_namespaces]]
binding = "TENANTS"
id = "your-kv-id"
```

## Architecture

The SDK has three layers. Start at the top, unwrap when needed:

```
┌─────────────────────────────────────────────────────┐
│  Platform (managed)                                 │
│  - Automatic storage + versioning                   │
│  - CRUD operations for tenants                      │
│  - Built-in routing                                 │
├─────────────────────────────────────────────────────┤
│  Storage (customizable)                             │
│  - KV, R2, D1, external DB                          │
│  - Implement TenantStorage interface                │
├─────────────────────────────────────────────────────┤
│  Core (bare metal)                                  │
│  - buildWorker() - bundle source files              │
│  - loadWorker() - use Worker Loader directly        │
│  - Full control over everything                     │
└─────────────────────────────────────────────────────┘
```

### Layer 1: Platform (Managed)

Use `Platform` for the common case:

```ts
const platform = Platform.fromEnv(env);

// CRUD operations
await platform.createTenant({ id: 'user-123', files: {...} });
await platform.updateTenant('user-123', { files: {...} });
await platform.deleteTenant('user-123');

// Execute
const response = await platform.routeRequest('user-123', request);
```

### Layer 2: Storage (Customizable)

Need custom storage? Implement `TenantStorage`:

```ts
import { Platform, type TenantStorage } from 'platforms-sdk';

class R2TenantStorage implements TenantStorage {
  constructor(private bucket: R2Bucket) {}
  
  async get(tenantId: string) {
    const obj = await this.bucket.get(`tenants/${tenantId}.json`);
    return obj ? JSON.parse(await obj.text()) : null;
  }
  
  async put(tenantId: string, record: TenantRecord) {
    await this.bucket.put(`tenants/${tenantId}.json`, JSON.stringify(record));
  }
  
  // ... implement delete, list
}

const platform = Platform.create({
  loader: env.LOADER,
  storage: new R2TenantStorage(env.BUCKET),
});
```

### Layer 3: Core (Bare Metal)

Maximum control with core functions:

```ts
import { buildWorker, loadWorker } from 'platforms-sdk/core';

// Build worker from source files
const { mainModule, modules } = await buildWorker(files, {
  bundle: true,
  minify: true,
});

// Load directly with Worker Loader
const worker = env.LOADER.get('my-worker', async () => ({
  mainModule,
  modules,
  compatibilityDate: '2026-01-01',
  env: { API_KEY: 'secret' },
}));

// Execute
const response = await worker.getEntrypoint().fetch(request);
```

## Examples

### Multi-file Worker with Dependencies

```ts
await platform.createTenant({
  id: 'api-service',
  files: {
    'src/index.ts': `
      import { Hono } from 'hono';
      import { cors } from 'hono/cors';
      
      const app = new Hono();
      app.use('*', cors());
      app.get('/', (c) => c.json({ status: 'ok' }));
      
      export default app;
    `,
    'package.json': JSON.stringify({
      dependencies: { hono: '^4.0.0' }
    }),
  },
});
```

### Custom Routing

```ts
export default {
  async fetch(request: Request, env: Env) {
    const platform = Platform.fromEnv(env);
    const url = new URL(request.url);
    
    // Route by subdomain
    const subdomain = url.hostname.split('.')[0];
    
    // Or route by path
    const match = url.pathname.match(/^\/tenant\/([^\/]+)/);
    const tenantId = match?.[1] ?? subdomain;
    
    return platform.routeRequest(tenantId, request);
  }
}
```

### Pass Environment to Tenants

```ts
await platform.createTenant({
  id: 'my-tenant',
  files: { ... },
  env: {
    DATABASE_URL: 'postgres://...',
    API_KEY: tenantApiKey,
  },
});
```

## Running the Playground

```bash
git clone https://github.com/cloudflare/workers-platforms-sdk
cd workers-platforms-sdk
npm install
npm run dev
```

Open http://localhost:8787 to see the playground.

## API Reference

### Platform

| Method | Description |
|--------|-------------|
| `Platform.fromEnv(env)` | Create from environment bindings |
| `Platform.create(options)` | Create with custom options |
| `createTenant(config)` | Create a new tenant |
| `updateTenant(id, updates)` | Update tenant (bumps version) |
| `getTenant(id)` | Get tenant config + metadata |
| `deleteTenant(id)` | Delete tenant |
| `listTenants(options?)` | List tenants with pagination |
| `routeRequest(id, request)` | Route request to tenant worker |
| `execute(id, options?)` | Execute with custom request |

### TenantConfig

```ts
interface TenantConfig {
  id: string;                           // Unique identifier
  files: Record<string, string>;        // Source files
  env?: Record<string, string>;         // Environment variables
  compatibilityDate?: string;           // Worker compat date
  compatibilityFlags?: string[];        // Worker compat flags
}
```

### Core Functions

```ts
// Build worker from source files
buildWorker(files, options?) → { mainModule, modules, warnings? }

// Load worker with Worker Loader
loadWorker(loader, name, factory) → WorkerStub

// Build and load in one step  
buildAndLoad(loader, name, config, options?) → WorkerStub

// Invoke worker's fetch handler
invokeWorker(worker, request, entrypoint?) → Response
```

## License

MIT
