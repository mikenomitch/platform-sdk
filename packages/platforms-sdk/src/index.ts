/**
 * Platforms SDK
 * 
 * A layered SDK for building platforms on Cloudflare Workers with Dynamic Workers.
 * 
 * ## Architecture
 * 
 * The SDK follows an "onion" architecture with three layers:
 * 
 * 1. **Platform** (managed) - High-level API with built-in storage, versioning, routing
 * 2. **Storage** (customizable) - Pluggable tenant storage (KV, R2, D1, external)
 * 3. **Core** (bare metal) - Direct access to build + Worker Loader primitives
 * 
 * Start with Platform for the 80% case. Unwrap layers when you need more control.
 * 
 * ## Quick Start
 * 
 * ```ts
 * import { Platform } from 'platforms-sdk';
 * 
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const platform = Platform.fromEnv(env);
 *     
 *     // Create a tenant
 *     await platform.createTenant({
 *       id: 'my-tenant',
 *       files: {
 *         'src/index.ts': `export default { fetch: () => new Response('Hello!') }`,
 *       },
 *     });
 *     
 *     // Route requests
 *     return platform.routeRequest('my-tenant', request);
 *   }
 * }
 * ```
 * 
 * ## Unwrapping Layers
 * 
 * ```ts
 * // Access storage directly
 * const record = await platform.storage.get('tenant-id');
 * 
 * // Access Worker Loader directly
 * const stub = platform.loader.get('my-worker', async () => ({
 *   mainModule: 'index.js',
 *   modules: { 'index.js': 'export default { fetch: () => new Response("Hi") }' },
 *   compatibilityDate: '2026-01-01',
 * }));
 * 
 * // Use core functions for full control
 * import { buildWorker, loadWorker } from 'platforms-sdk/core';
 * const result = await buildWorker(files, { minify: true });
 * ```
 */

// High-level managed layer
export { Platform, type PlatformOptions } from './platform.js';

// Storage layer
export {
  KVTenantStorage,
  MemoryTenantStorage,
  type TenantStorage,
} from './storage/index.js';

// Core primitives
export {
  buildWorker,
  loadWorker,
  buildAndLoad,
  invokeWorker,
  createWorker,
} from './core/index.js';

// Types
export type {
  Files,
  Modules,
  TenantConfig,
  TenantMetadata,
  TenantRecord,
  TenantOptions,
  BuildResult,
  WorkerLoader,
  WorkerStub,
  PlatformEnv,
} from './types.js';
