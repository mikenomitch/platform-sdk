/**
 * Core layer - the building blocks
 * 
 * This is the "bare metal" layer. Use this when you want full control
 * over how workers are built and invoked.
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
 * Load a worker using the Worker Loader binding
 * 
 * This is the lowest-level API for loading dynamic workers.
 * Use it when you want direct control over the Worker Loader.
 */
export function loadWorker(
  loader: WorkerLoader,
  name: string,
  factory: () => Promise<{
    mainModule: string;
    modules: Modules;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    env?: Record<string, unknown>;
  }>
): WorkerStub {
  return loader.get(name, factory);
}

/**
 * Build and load a worker in one step
 * 
 * Convenience function that combines build + load.
 */
export async function buildAndLoad(
  loader: WorkerLoader,
  name: string,
  config: TenantConfig,
  options?: {
    bundle?: boolean;
    minify?: boolean;
    sourcemap?: boolean;
  }
): Promise<WorkerStub> {
  return loader.get(name, async () => {
    const result = await buildWorker(config.files, options);
    return {
      mainModule: result.mainModule,
      modules: result.modules as Record<string, string>,
      compatibilityDate: config.compatibilityDate ?? '2026-01-01',
      compatibilityFlags: config.compatibilityFlags ?? [],
      env: config.env ?? {},
    };
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
