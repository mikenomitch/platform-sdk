# Platforms SDK

Build platforms on Cloudflare Workers using [Dynamic Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) (Worker Loader binding).

## Why Dynamic Workers?

Workers for Platforms (WFP) provides a managed experience, but sometimes you need more control:

- **Full control** - No wrappers, your API surface
- **Escape hatches** - Need smart placement? OTEL? Custom billing? Just do it.

## Model

- **Tenants** define defaults (env, compat date, flags)
- **Workers** belong to tenants and inherit those defaults
- Multiple workers per tenant, each independently versioned

## Quick Start

```bash
npm install platforms-sdk
```

```ts
import { Platform } from 'platforms-sdk';

export default {
  async fetch(request: Request, env: Env) {
    const platform = Platform.create({
      loader: env.LOADER,
      tenantsKV: env.TENANTS,
      workersKV: env.WORKERS,
    });

    // Create a tenant with defaults
    await platform.createTenant({
      id: 'acme-corp',
      env: { API_BASE: 'https://api.acme.com' },
    });

    // Create workers (inherit tenant defaults)
    await platform.createWorker('acme-corp', {
      id: 'api-handler',
      files: { 'src/index.ts': '...' },
    });

    await platform.createWorker('acme-corp', {
      id: 'webhook-processor',
      files: { 'src/index.ts': '...' },
      env: { WEBHOOK_SECRET: '...' }, // merged with tenant env
    });

    // Execute
    return platform.fetch('acme-corp', 'api-handler', request);
  }
}
```

Configure `wrangler.toml`:

```toml
[[worker_loaders]]
binding = "LOADER"

[[kv_namespaces]]
binding = "TENANTS"
id = "your-tenants-kv"

[[kv_namespaces]]
binding = "WORKERS"
id = "your-workers-kv"
```

## Architecture

Three layers, unwrap when needed:

```
┌─────────────────────────────────────────────────────┐
│  Platform (managed)                                 │
│  - Tenant + Worker CRUD                             │
│  - Automatic env inheritance                        │
│  - Versioning and caching                           │
├─────────────────────────────────────────────────────┤
│  Storage (customizable)                             │
│  - KV, R2, D1, external DB                          │
│  - Implement TenantStorage/WorkerStorage            │
├─────────────────────────────────────────────────────┤
│  Core (primitives)                                  │
│  - buildWorker() - bundle source files              │
│  - loadWorker() - use Worker Loader directly        │
└─────────────────────────────────────────────────────┘
```

## API

### Tenants

```ts
// Create tenant with defaults
await platform.createTenant({
  id: 'acme',
  env: { API_KEY: 'secret' },
  compatibilityDate: '2024-12-01',
});

// Update tenant (invalidates all worker caches)
await platform.updateTenant('acme', { 
  env: { API_KEY: 'new-secret' } 
});

// Get/Delete/List
await platform.getTenant('acme');
await platform.deleteTenant('acme'); // also deletes all workers
await platform.listTenants({ limit: 50 });
```

### Workers

```ts
// Create worker (inherits tenant defaults)
await platform.createWorker('acme', {
  id: 'main',
  files: {
    'src/index.ts': `export default { fetch: () => new Response('Hi') }`,
    'package.json': '{"main":"src/index.ts"}',
  },
});

// Create worker with overrides
await platform.createWorker('acme', {
  id: 'special',
  files: { ... },
  env: { OVERRIDE: 'value' }, // merged with tenant env
  compatibilityFlags: ['nodejs_compat'],
});

// Update worker (bumps version)
await platform.updateWorker('acme', 'main', { 
  files: { ... } 
});

// Get/Delete/List
await platform.getWorker('acme', 'main');
await platform.deleteWorker('acme', 'main');
await platform.listWorkers('acme');
```

### Execution

```ts
// Execute a worker
const response = await platform.fetch('acme', 'main', request);

// Run ephemeral code with tenant defaults (not persisted)
const response = await platform.runEphemeral('acme', files, request);
```

## Core Layer

For full control, use core functions directly:

```ts
import { buildWorker, loadWorker, invokeWorker } from 'platforms-sdk/core';

// Build
const { mainModule, modules } = await buildWorker(files, { minify: true });

// Load
const worker = loadWorker(env.LOADER, {
  name: 'my-worker',
  mainModule,
  modules,
  env: { SECRET: 'value' },
});

// Execute
const response = await invokeWorker(worker, request);
```

## Outbound Interception

Intercept all `fetch()` calls from tenant workers:

```ts
import { WorkerEntrypoint, exports } from 'cloudflare:workers';

export class OutboundHandler extends WorkerEntrypoint {
  async fetch(request: Request) {
    console.log(`Outbound: ${request.method} ${request.url}`);
    return fetch(request);
  }
}

const platform = Platform.create({
  loader: env.LOADER,
  outbound: exports.OutboundHandler(),
});
```

## Running the Playground

```bash
git clone https://github.com/cloudflare/workers-platforms-sdk
cd workers-platforms-sdk
npm install
npm run dev
```

Open http://localhost:8787

## License

MIT
