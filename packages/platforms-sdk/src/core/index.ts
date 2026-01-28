/**
 * Core layer - the building blocks
 * 
 * Use this when you want full control over how workers are built and invoked.
 */

import { createWorker, type CreateWorkerOptions, type CreateWorkerResult } from 'workers-builder';
import type { Files, Modules, WorkerLoader, WorkerStub, TenantConfig } from '../types.js';

export { createWorker };
export type { CreateWorkerOptions, CreateWorkerResult };

/**
 * Build worker code from source files
 * 
 * This is a thin wrapper around workers-builder. Use it directly
 * when you want full control over the build process.
 */
export async function buildWorker(
  files: Files,
  options?: {
    bundle?: boolean;
    minify?: boolean;
    sourcemap?: boolean;
    entryPoint?: string;
    externals?: string[];
  }
): Promise<CreateWorkerResult> {
  return createWorker({
    files,
    bundle: options?.bundle ?? true,
    minify: options?.minify ?? false,
    sourcemap: options?.sourcemap ?? false,
    entryPoint: options?.entryPoint,
    externals: options?.externals,
  });
}

/**
 * Resource limits for a worker
 */
export interface LoadWorkerLimits {
  /** CPU time limit in milliseconds */
  cpuMs?: number;
  /** Maximum number of subrequests (not yet supported) */
  subrequests?: number;
}

/**
 * Options for loading a worker
 */
export interface LoadWorkerOptions {
  /** Worker name (used for caching) */
  name: string;
  /** Entry point module path */
  mainModule: string;
  /** All modules (path -> content) */
  modules: Modules;
  /** Environment variables to pass to the worker */
  env?: Record<string, unknown>;
  /** Compatibility date (defaults to a stable date) */
  compatibilityDate?: string;
  /** Compatibility flags */
  compatibilityFlags?: string[];
  /** Outbound worker - intercepts all fetch() calls from this worker */
  outbound?: Fetcher;
  /** Tail workers for logging/tracing */
  tails?: unknown[];
  /** Resource limits */
  limits?: LoadWorkerLimits;
}

/**
 * Load a worker using the Worker Loader binding
 */
export function loadWorker(loader: WorkerLoader, options: LoadWorkerOptions): WorkerStub {
  return loader.get(options.name, async () => ({
    mainModule: options.mainModule,
    modules: options.modules as Record<string, string>,
    compatibilityDate: options.compatibilityDate ?? '2026-01-24',
    compatibilityFlags: options.compatibilityFlags ?? [],
    env: options.env ?? {},
    globalOutbound: options.outbound ?? null,
    tails: options.tails ?? [],
    limits: options.limits,
  }));
}

/**
 * Build and load a worker in one step
 */
export async function buildAndLoad(
  loader: WorkerLoader,
  name: string,
  files: Files,
  options?: {
    bundle?: boolean;
    minify?: boolean;
    sourcemap?: boolean;
    env?: Record<string, unknown>;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    outbound?: Fetcher;
    tails?: unknown[];
    limits?: LoadWorkerLimits;
  }
): Promise<WorkerStub> {
  const result = await buildWorker(files, options);
  
  return loadWorker(loader, {
    name,
    mainModule: result.mainModule,
    modules: result.modules as Modules,
    env: options?.env,
    compatibilityDate: options?.compatibilityDate,
    compatibilityFlags: options?.compatibilityFlags,
    outbound: options?.outbound,
    tails: options?.tails,
    limits: options?.limits,
  });
}

/**
 * Invoke a worker's fetch handler
 */
export async function invokeWorker(
  worker: WorkerStub,
  request: Request,
  entrypoint?: string
): Promise<Response> {
  const fetcher = worker.getEntrypoint(entrypoint);
  return fetcher.fetch(request);
}

/**
 * Create an outbound worker that intercepts all fetch() calls from tenant workers.
 * 
 * Use this to:
 * - Log all outbound requests
 * - Add authentication headers
 * - Rate limit external API calls
 * - Route through a proxy
 * - Block certain domains
 * 
 * @example
 * ```ts
 * // Log all outbound requests
 * const outbound = createOutbound(env.LOADER, async (request, fetch) => {
 *   console.log(`Outbound: ${request.method} ${request.url}`);
 *   return fetch(request);
 * });
 * 
 * const worker = loadWorker(env.LOADER, {
 *   name: 'my-worker',
 *   mainModule,
 *   modules,
 *   outbound,
 * });
 * ```
 * 
 * @example
 * ```ts
 * // Add auth header to all requests
 * const outbound = createOutbound(env.LOADER, async (request, fetch) => {
 *   const authedRequest = new Request(request, {
 *     headers: { ...Object.fromEntries(request.headers), 'Authorization': 'Bearer xxx' },
 *   });
 *   return fetch(authedRequest);
 * });
 * ```
 * 
 * @example
 * ```ts
 * // Block external requests
 * const outbound = createOutbound(env.LOADER, async (request, fetch) => {
 *   const url = new URL(request.url);
 *   if (url.hostname !== 'api.allowed.com') {
 *     return new Response('Forbidden', { status: 403 });
 *   }
 *   return fetch(request);
 * });
 * ```
 */
/**
 * Helper type for defining an outbound handler.
 * 
 * Define your outbound as a WorkerEntrypoint class:
 * 
 * ```ts
 * import { WorkerEntrypoint } from 'cloudflare:workers';
 * 
 * export class OutboundHandler extends WorkerEntrypoint {
 *   async fetch(request: Request) {
 *     console.log(`Outbound: ${request.method} ${request.url}`);
 *     return fetch(request); // Continue to actual destination
 *   }
 * }
 * ```
 * 
 * Then pass it to loadWorker using `exports`:
 * 
 * ```ts
 * import { exports } from 'cloudflare:workers';
 * 
 * const worker = loadWorker(env.LOADER, {
 *   name: 'my-worker',
 *   mainModule,
 *   modules,
 *   outbound: exports.OutboundHandler(),
 * });
 * ```
 */
export type OutboundWorker = Fetcher;
