/**
 * Core types for the Platforms SDK
 */

// Files map: path -> content
export type Files = Record<string, string>;

// Modules map: path -> compiled content
export type Modules = Record<string, string>;

/**
 * Resource limits for a worker
 */
export interface WorkerLimits {
  /** CPU time limit in milliseconds */
  cpuMs?: number;
  /** Maximum number of subrequests (fetch calls) - not yet supported */
  subrequests?: number;
}

/**
 * Tail worker reference - use ctx.exports.TailWorkerClass() to create
 */
export type TailWorker = unknown;

/**
 * Default configuration that can be set at global, tenant, or worker level.
 * Inheritance: global → tenant → worker (later values override earlier)
 */
export interface WorkerDefaults {
  /** Environment variables */
  env?: Record<string, string>;
  /** Compatibility date */
  compatibilityDate?: string;
  /** Compatibility flags */
  compatibilityFlags?: string[];
  /** Resource limits */
  limits?: WorkerLimits;
  /** 
   * Tail workers for observability (logs, errors, traces).
   * Use ctx.exports.YourTailWorker({ props: { ... } }) to create.
   * Arrays are concatenated across levels (global + tenant + worker).
   */
  tails?: TailWorker[];
}

/**
 * Tenant configuration - defines defaults for all workers belonging to this tenant
 * These override global defaults and are overridden by worker-specific config.
 */
export interface TenantConfig extends WorkerDefaults {
  /** Unique identifier for this tenant */
  id: string;
}

/**
 * Worker configuration - a single dynamic worker belonging to a tenant
 * These override tenant defaults (which override global defaults).
 */
export interface WorkerConfig extends WorkerDefaults {
  /** Unique identifier for this worker (scoped to tenant) */
  id: string;
  /** Tenant this worker belongs to */
  tenantId: string;
  /** Source files for the worker */
  files: Files;
  /** Hostnames that route to this worker */
  hostnames?: string[];
}

/**
 * Metadata for a tenant
 */
export interface TenantMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full tenant record
 */
export interface TenantRecord {
  metadata: TenantMetadata;
  config: TenantConfig;
}

/**
 * Metadata for a worker
 */
export interface WorkerMetadata {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * Full worker record
 */
export interface WorkerRecord {
  metadata: WorkerMetadata;
  config: WorkerConfig;
}

/**
 * Options for building a worker
 */
export interface BuildOptions {
  bundle?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
}

/**
 * Options for creating/updating a worker
 */
export interface WorkerOptions {
  build?: BuildOptions;
}

/**
 * Storage interface for tenants
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
 * Storage interface for workers
 */
export interface WorkerStorage {
  get(tenantId: string, workerId: string): Promise<WorkerRecord | null>;
  put(tenantId: string, workerId: string, record: WorkerRecord): Promise<void>;
  delete(tenantId: string, workerId: string): Promise<boolean>;
  list(tenantId: string, options?: { limit?: number; cursor?: string }): Promise<{
    workers: WorkerMetadata[];
    cursor?: string;
  }>;
  /** Delete all workers for a tenant */
  deleteAll(tenantId: string): Promise<number>;
}

/**
 * Hostname routing entry
 */
export interface HostnameRoute {
  hostname: string;
  tenantId: string;
  workerId: string;
}

/**
 * Storage interface for hostname routing
 */
export interface HostnameStorage {
  get(hostname: string): Promise<HostnameRoute | null>;
  put(hostname: string, route: HostnameRoute): Promise<void>;
  delete(hostname: string): Promise<boolean>;
  /** List all hostnames for a worker */
  listByWorker(tenantId: string, workerId: string): Promise<string[]>;
  /** Delete all hostnames for a worker */
  deleteByWorker(tenantId: string, workerId: string): Promise<number>;
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
      limits?: {
        cpuMs?: number;
        subrequests?: number;
      };
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
  WORKERS?: KVNamespace;
}
