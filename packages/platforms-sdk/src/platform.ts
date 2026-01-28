/**
 * Platform - the high-level managed layer
 * 
 * This is the "fully managed" experience. Use Platform when you want:
 * - Automatic tenant storage and versioning
 * - Simple CRUD operations for tenant workers
 * - Built-in routing and execution
 * 
 * Need more control? Unwrap to lower layers:
 * - platform.storage -> Access the storage layer directly
 * - platform.loader -> Access the Worker Loader directly
 * - Use core/* functions for bare-metal control
 */

import { buildWorker, invokeWorker } from './core/index.js';
import { KVTenantStorage, MemoryTenantStorage } from './storage/index.js';
import type {
  TenantConfig,
  TenantMetadata,
  TenantRecord,
  TenantStorage,
  TenantOptions,
  WorkerLoader,
  WorkerStub,
  PlatformEnv,
} from './types.js';

export interface PlatformOptions {
  /** Worker Loader binding */
  loader: WorkerLoader;
  /** Custom storage implementation (defaults to KV or memory) */
  storage?: TenantStorage;
  /** KV namespace for default storage */
  kv?: KVNamespace;
  /** Default compatibility date for tenant workers */
  defaultCompatibilityDate?: string;
  /** Default compatibility flags for tenant workers */
  defaultCompatibilityFlags?: string[];
}

/**
 * Platform SDK - managed layer for building platforms
 * 
 * @example
 * ```ts
 * // Create platform with KV storage
 * const platform = Platform.create({
 *   loader: env.LOADER,
 *   kv: env.TENANTS,
 * });
 * 
 * // Create a tenant
 * await platform.createTenant({
 *   id: 'user-123',
 *   files: {
 *     'src/index.ts': `export default { fetch: () => new Response('Hello!') }`,
 *   },
 * });
 * 
 * // Route a request to the tenant
 * const response = await platform.routeRequest('user-123', request);
 * ```
 */
export class Platform {
  /** Storage layer - unwrap for custom storage operations */
  public readonly storage: TenantStorage;
  /** Worker Loader - unwrap for direct loader access */
  public readonly loader: WorkerLoader;

  private readonly defaultCompatibilityDate: string;
  private readonly defaultCompatibilityFlags: string[];
  private readonly workerCache = new Map<string, { version: number; stub: WorkerStub }>();

  private constructor(options: PlatformOptions) {
    this.loader = options.loader;
    this.storage = options.storage ?? (options.kv ? new KVTenantStorage(options.kv) : new MemoryTenantStorage());
    this.defaultCompatibilityDate = options.defaultCompatibilityDate ?? '2026-01-01';
    this.defaultCompatibilityFlags = options.defaultCompatibilityFlags ?? [];
  }

  /**
   * Create a Platform instance
   */
  static create(options: PlatformOptions): Platform {
    return new Platform(options);
  }

  /**
   * Create a Platform from environment bindings
   * Convenience method for common setup
   */
  static fromEnv(env: PlatformEnv): Platform {
    return new Platform({
      loader: env.LOADER,
      kv: env.TENANTS,
    });
  }

  /**
   * Create a new tenant
   */
  async createTenant(config: TenantConfig, options?: TenantOptions): Promise<TenantMetadata> {
    const existing = await this.storage.get(config.id);
    if (existing) {
      throw new Error(`Tenant "${config.id}" already exists. Use updateTenant() instead.`);
    }

    const now = new Date().toISOString();
    const metadata: TenantMetadata = {
      id: config.id,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    // Validate the worker compiles
    await buildWorker(config.files, options?.build);

    const record: TenantRecord = { metadata, config };
    await this.storage.put(config.id, record);

    return metadata;
  }

  /**
   * Update an existing tenant
   * Returns the new version number
   */
  async updateTenant(
    tenantId: string,
    updates: Partial<Omit<TenantConfig, 'id'>>,
    options?: TenantOptions
  ): Promise<TenantMetadata> {
    const existing = await this.storage.get(tenantId);
    if (!existing) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const config: TenantConfig = {
      ...existing.config,
      ...updates,
      id: tenantId,
    };

    // Validate the worker compiles
    await buildWorker(config.files, options?.build);

    const metadata: TenantMetadata = {
      ...existing.metadata,
      updatedAt: new Date().toISOString(),
      version: existing.metadata.version + 1,
    };

    const record: TenantRecord = { metadata, config };
    await this.storage.put(tenantId, record);

    // Invalidate cached worker
    this.workerCache.delete(tenantId);

    return metadata;
  }

  /**
   * Get a tenant's configuration
   */
  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    return this.storage.get(tenantId);
  }

  /**
   * Delete a tenant
   */
  async deleteTenant(tenantId: string): Promise<boolean> {
    this.workerCache.delete(tenantId);
    return this.storage.delete(tenantId);
  }

  /**
   * List tenants
   */
  async listTenants(options?: { prefix?: string; limit?: number; cursor?: string }) {
    return this.storage.list(options);
  }

  /**
   * Get or create a worker stub for a tenant
   * Workers are cached and reused until the tenant is updated
   */
  async getWorker(tenantId: string, options?: TenantOptions): Promise<WorkerStub> {
    const record = await this.storage.get(tenantId);
    if (!record) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    // Check if we have a cached worker at the current version
    const cached = this.workerCache.get(tenantId);
    if (cached && cached.version === record.metadata.version) {
      return cached.stub;
    }

    // Build and load the worker
    const workerName = `tenant-${tenantId}-v${record.metadata.version}`;
    const stub = this.loader.get(workerName, async () => {
      const result = await buildWorker(record.config.files, options?.build);
      return {
        mainModule: result.mainModule,
        modules: result.modules as Record<string, string>,
        compatibilityDate: record.config.compatibilityDate ?? this.defaultCompatibilityDate,
        compatibilityFlags: record.config.compatibilityFlags ?? this.defaultCompatibilityFlags,
        env: record.config.env ?? {},
      };
    });

    // Cache the stub
    this.workerCache.set(tenantId, { version: record.metadata.version, stub });

    return stub;
  }

  /**
   * Route a request to a tenant's worker
   * 
   * This is the main entry point for handling tenant requests.
   */
  async routeRequest(
    tenantId: string,
    request: Request,
    options?: TenantOptions & { entrypoint?: string }
  ): Promise<Response> {
    const worker = await this.getWorker(tenantId, options);
    return invokeWorker(worker, request, options?.entrypoint);
  }

  /**
   * Execute a tenant worker with an ad-hoc request
   * 
   * Useful for testing or one-off executions.
   */
  async execute(
    tenantId: string,
    options?: TenantOptions & {
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ): Promise<Response> {
    const request = new Request(`https://tenant.local${options?.path ?? '/'}`, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
    });

    return this.routeRequest(tenantId, request, options);
  }
}

export type { TenantConfig, TenantMetadata, TenantRecord, TenantStorage, TenantOptions };
