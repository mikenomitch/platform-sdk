/**
 * Platforms SDK
 * 
 * Build platforms on Cloudflare Workers with Dynamic Workers.
 * 
 * ## Model
 * 
 * - **Tenants** define defaults (env, compat date, flags)
 * - **Workers** belong to tenants and inherit those defaults
 * - Multiple workers per tenant, each independently versioned
 * 
 * ## Quick Start
 * 
 * ```ts
 * import { Platform } from 'platforms-sdk';
 * 
 * const platform = Platform.create({
 *   loader: env.LOADER,
 *   tenantsKV: env.TENANTS,
 *   workersKV: env.WORKERS,
 * });
 * 
 * // Create a tenant with defaults
 * await platform.createTenant({
 *   id: 'acme-corp',
 *   env: { API_BASE: 'https://api.acme.com' },
 * });
 * 
 * // Create workers (inherit tenant defaults)
 * await platform.createWorker('acme-corp', {
 *   id: 'main',
 *   files: { 'src/index.ts': '...' },
 * });
 * 
 * // Execute
 * return platform.fetch('acme-corp', 'main', request);
 * ```
 */

// High-level managed layer
export { Platform, type PlatformOptions } from './platform.js';

// Storage layer
export {
  KVTenantStorage,
  KVWorkerStorage,
  KVHostnameStorage,
  MemoryTenantStorage,
  MemoryWorkerStorage,
  MemoryHostnameStorage,
} from './storage/index.js';

// Core primitives
export {
  buildWorker,
  loadWorker,
  buildAndLoad,
  invokeWorker,
  createWorker,
  type LoadWorkerOptions,
  type OutboundWorker,
} from './core/index.js';

// Types
export type {
  Files,
  Modules,
  TenantConfig,
  TenantMetadata,
  TenantRecord,
  TenantStorage,
  WorkerConfig,
  WorkerMetadata,
  WorkerRecord,
  WorkerStorage,
  WorkerOptions,
  WorkerDefaults,
  WorkerLimits,
  TailWorker,
  BuildOptions,
  WorkerLoader,
  WorkerStub,
  HostnameStorage,
  HostnameRoute,
  PlatformEnv,
} from './types.js';
