/**
 * Core types for the Platforms SDK
 */

// Files map: path -> content
export type Files = Record<string, string>;

// Modules map: path -> compiled content
export type Modules = Record<string, string>;

/**
 * Configuration for a tenant worker
 */
export interface TenantConfig {
  /** Unique identifier for this tenant */
  id: string;
  /** Source files for the worker */
  files: Files;
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Optional compatibility date */
  compatibilityDate?: string;
  /** Optional compatibility flags */
  compatibilityFlags?: string[];
}

/**
 * Result from building a tenant worker
 */
export interface BuildResult {
  mainModule: string;
  modules: Modules;
  warnings?: string[];
}

/**
 * Metadata stored for a tenant
 */
export interface TenantMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * Full tenant record (metadata + config)
 */
export interface TenantRecord {
  metadata: TenantMetadata;
  config: TenantConfig;
}

/**
 * Options for creating/updating a tenant
 */
export interface TenantOptions {
  /** Build options */
  build?: {
    bundle?: boolean;
    minify?: boolean;
    sourcemap?: boolean;
  };
}

/**
 * Storage interface - implement this to store tenant data
 * This is the "unwrap point" for storage customization
 */
export interface TenantStorage {
  get(tenantId: string): Promise<TenantRecord | null>;
  put(tenantId: string, record: TenantRecord): Promise<void>;
  delete(tenantId: string): Promise<boolean>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    tenants: TenantMetadata[];
    cursor?: string;
  }>;
}

/**
 * Worker Loader binding type (from Cloudflare)
 */
export interface WorkerLoader {
  get(
    name: string,
    factory: () => Promise<{
      mainModule: string;
      modules: Modules;
      compatibilityDate?: string;
      compatibilityFlags?: string[];
      env?: Record<string, unknown>;
      globalOutbound?: unknown;
      tails?: unknown[];
    }>
  ): WorkerStub;
}

/**
 * Worker stub returned from loader
 */
export interface WorkerStub {
  getEntrypoint(name?: string): Fetcher;
}

/**
 * Environment bindings required by the SDK
 */
export interface PlatformEnv {
  LOADER: WorkerLoader;
  TENANTS?: KVNamespace;
}
