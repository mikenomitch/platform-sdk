/**
 * Platform - the high-level managed layer
 * 
 * Tenants define defaults. Workers belong to tenants and inherit those defaults.
 * Multiple workers per tenant, each independently versioned and trackable.
 */

import { buildWorker } from './core/index.js';
import {
  KVTenantStorage,
  KVWorkerStorage,
  KVHostnameStorage,
  MemoryTenantStorage,
  MemoryWorkerStorage,
  MemoryHostnameStorage,
} from './storage/index.js';
import type {
  Files,
  TenantConfig,
  TenantMetadata,
  TenantRecord,
  TenantStorage,
  WorkerConfig,
  WorkerMetadata,
  WorkerRecord,
  WorkerStorage,
  WorkerOptions,
  WorkerLoader,
  WorkerStub,
  WorkerDefaults,
  WorkerLimits,
  TailWorker,
  HostnameStorage,
  HostnameRoute,
  PlatformEnv,
} from './types.js';

export interface PlatformOptions {
  /** Worker Loader binding */
  loader: WorkerLoader;
  /** Tenant storage (defaults to KV or memory) */
  tenantStorage?: TenantStorage;
  /** Worker storage (defaults to KV or memory) */
  workerStorage?: WorkerStorage;
  /** Hostname storage (defaults to KV or memory) */
  hostnameStorage?: HostnameStorage;
  /** KV namespace for tenant storage */
  tenantsKV?: KVNamespace;
  /** KV namespace for worker storage */
  workersKV?: KVNamespace;
  /** KV namespace for hostname routing */
  hostnamesKV?: KVNamespace;
  /** 
   * Global defaults applied to all workers.
   * Inheritance: defaults → tenant config → worker config
   */
  defaults?: WorkerDefaults;
  /** Global outbound worker - intercepts all fetch() calls */
  outbound?: Fetcher;
}

/**
 * Platform SDK
 * 
 * @example
 * ```ts
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
 * // Create workers for the tenant (inherits tenant defaults)
 * await platform.createWorker('acme-corp', {
 *   id: 'api-handler',
 *   files: { 'src/index.ts': '...' },
 * });
 * 
 * await platform.createWorker('acme-corp', {
 *   id: 'webhook-processor',
 *   files: { 'src/index.ts': '...' },
 *   env: { WEBHOOK_SECRET: '...' }, // merged with tenant env
 * });
 * 
 * // Route requests
 * return platform.fetch('acme-corp', 'api-handler', request);
 * ```
 */
export class Platform {
  public readonly tenants: TenantStorage;
  public readonly workers: WorkerStorage;
  public readonly hostnames: HostnameStorage;
  public readonly loader: WorkerLoader;

  private _defaults: WorkerDefaults;
  private readonly outbound?: Fetcher;
  private readonly stubCache = new Map<string, { version: number; stub: WorkerStub }>();

  private constructor(options: PlatformOptions) {
    this.loader = options.loader;
    
    // Initialize tenant storage
    if (options.tenantStorage) {
      this.tenants = options.tenantStorage;
    } else if (options.tenantsKV) {
      this.tenants = new KVTenantStorage(options.tenantsKV);
    } else {
      this.tenants = new MemoryTenantStorage();
    }

    // Initialize worker storage
    if (options.workerStorage) {
      this.workers = options.workerStorage;
    } else if (options.workersKV) {
      this.workers = new KVWorkerStorage(options.workersKV);
    } else {
      this.workers = new MemoryWorkerStorage();
    }

    // Initialize hostname storage
    if (options.hostnameStorage) {
      this.hostnames = options.hostnameStorage;
    } else if (options.hostnamesKV) {
      this.hostnames = new KVHostnameStorage(options.hostnamesKV);
    } else {
      this.hostnames = new MemoryHostnameStorage();
    }

    // Global defaults (fallback values)
    this._defaults = {
      env: options.defaults?.env ?? {},
      compatibilityDate: options.defaults?.compatibilityDate ?? '2024-12-01',
      compatibilityFlags: options.defaults?.compatibilityFlags ?? [],
      limits: options.defaults?.limits,
      tails: options.defaults?.tails ?? [],
    };
    this.outbound = options.outbound;
  }

  static create(options: PlatformOptions): Platform {
    return new Platform(options);
  }

  static fromEnv(env: PlatformEnv): Platform {
    return new Platform({
      loader: env.LOADER,
      tenantsKV: env.TENANTS,
      workersKV: env.WORKERS,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Platform Defaults
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get current platform defaults
   */
  getDefaults(): WorkerDefaults {
    return { ...this._defaults };
  }

  /**
   * Update platform defaults
   * 
   * Updates are merged with existing defaults. Invalidates all cached worker stubs.
   * 
   * @example
   * ```ts
   * platform.updateDefaults({
   *   env: { NEW_VAR: 'value' },
   *   limits: { cpuMs: 100 },
   * });
   * ```
   */
  updateDefaults(updates: Partial<WorkerDefaults>): void {
    this._defaults = {
      env: { ...this._defaults.env, ...updates.env },
      compatibilityDate: updates.compatibilityDate ?? this._defaults.compatibilityDate,
      compatibilityFlags: updates.compatibilityFlags ?? this._defaults.compatibilityFlags,
      limits: updates.limits !== undefined
        ? { ...this._defaults.limits, ...updates.limits }
        : this._defaults.limits,
      tails: updates.tails ?? this._defaults.tails,
    };

    // Invalidate all cached stubs since defaults changed
    this.stubCache.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tenant Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async createTenant(config: TenantConfig): Promise<TenantMetadata> {
    const existing = await this.tenants.get(config.id);
    if (existing) {
      throw new Error(`Tenant "${config.id}" already exists`);
    }

    const now = new Date().toISOString();
    const metadata: TenantMetadata = {
      id: config.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.tenants.put(config.id, { metadata, config });
    return metadata;
  }

  async updateTenant(tenantId: string, updates: Partial<Omit<TenantConfig, 'id'>>): Promise<TenantMetadata> {
    const existing = await this.tenants.get(tenantId);
    if (!existing) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const config: TenantConfig = { ...existing.config, ...updates, id: tenantId };
    const metadata: TenantMetadata = {
      ...existing.metadata,
      updatedAt: new Date().toISOString(),
    };

    await this.tenants.put(tenantId, { metadata, config });
    
    // Invalidate all cached workers for this tenant
    for (const key of this.stubCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.stubCache.delete(key);
      }
    }

    return metadata;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    return this.tenants.get(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    // Delete all workers first
    await this.workers.deleteAll(tenantId);
    
    // Invalidate cache
    for (const key of this.stubCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.stubCache.delete(key);
      }
    }

    return this.tenants.delete(tenantId);
  }

  async listTenants(options?: { prefix?: string; limit?: number; cursor?: string }) {
    return this.tenants.list(options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Worker Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new worker for a tenant
   */
  async createWorker(
    tenantId: string,
    config: Omit<WorkerConfig, 'tenantId'>,
    options?: WorkerOptions
  ): Promise<WorkerMetadata> {
    // Verify tenant exists
    const tenant = await this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const existing = await this.workers.get(tenantId, config.id);
    if (existing) {
      throw new Error(`Worker "${config.id}" already exists for tenant "${tenantId}"`);
    }

    // Validate the worker compiles
    await buildWorker(config.files, options?.build);

    const now = new Date().toISOString();
    const metadata: WorkerMetadata = {
      id: config.id,
      tenantId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const fullConfig: WorkerConfig = { ...config, tenantId };
    await this.workers.put(tenantId, config.id, { metadata, config: fullConfig });

    // Register hostnames if provided
    if (config.hostnames?.length) {
      await this.addHostnames(tenantId, config.id, config.hostnames);
    }

    return metadata;
  }

  /**
   * Update an existing worker
   */
  async updateWorker(
    tenantId: string,
    workerId: string,
    updates: Partial<Omit<WorkerConfig, 'id' | 'tenantId'>>,
    options?: WorkerOptions
  ): Promise<WorkerMetadata> {
    const existing = await this.workers.get(tenantId, workerId);
    if (!existing) {
      throw new Error(`Worker "${workerId}" not found for tenant "${tenantId}"`);
    }

    const config: WorkerConfig = {
      ...existing.config,
      ...updates,
      id: workerId,
      tenantId,
    };

    // Validate the worker compiles
    await buildWorker(config.files, options?.build);

    const metadata: WorkerMetadata = {
      ...existing.metadata,
      updatedAt: new Date().toISOString(),
      version: existing.metadata.version + 1,
    };

    await this.workers.put(tenantId, workerId, { metadata, config });

    // Invalidate cache
    this.stubCache.delete(`${tenantId}:${workerId}`);

    return metadata;
  }

  /**
   * Get a worker's configuration
   */
  async getWorker(tenantId: string, workerId: string): Promise<WorkerRecord | null> {
    return this.workers.get(tenantId, workerId);
  }

  /**
   * Delete a worker
   */
  async deleteWorker(tenantId: string, workerId: string): Promise<boolean> {
    this.stubCache.delete(`${tenantId}:${workerId}`);
    // Delete associated hostnames
    await this.hostnames.deleteByWorker(tenantId, workerId);
    return this.workers.delete(tenantId, workerId);
  }

  /**
   * List all workers for a tenant
   */
  async listWorkers(tenantId: string, options?: { limit?: number; cursor?: string }) {
    return this.workers.list(tenantId, options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hostname Routing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add hostnames to a worker
   */
  async addHostnames(tenantId: string, workerId: string, hostnames: string[]): Promise<void> {
    // Verify worker exists
    const worker = await this.workers.get(tenantId, workerId);
    if (!worker) {
      throw new Error(`Worker "${workerId}" not found for tenant "${tenantId}"`);
    }

    for (const hostname of hostnames) {
      // Check if hostname is already assigned to another worker
      const existing = await this.hostnames.get(hostname);
      if (existing && (existing.tenantId !== tenantId || existing.workerId !== workerId)) {
        throw new Error(`Hostname "${hostname}" is already assigned to ${existing.tenantId}/${existing.workerId}`);
      }
      
      await this.hostnames.put(hostname, { hostname, tenantId, workerId });
    }

    // Update worker config to include hostnames
    const currentHostnames = worker.config.hostnames ?? [];
    const newHostnames = [...new Set([...currentHostnames, ...hostnames])];
    if (newHostnames.length !== currentHostnames.length) {
      await this.workers.put(tenantId, workerId, {
        ...worker,
        config: { ...worker.config, hostnames: newHostnames },
      });
    }
  }

  /**
   * Remove hostnames from a worker
   */
  async removeHostnames(tenantId: string, workerId: string, hostnames: string[]): Promise<void> {
    const worker = await this.workers.get(tenantId, workerId);
    if (!worker) {
      throw new Error(`Worker "${workerId}" not found for tenant "${tenantId}"`);
    }

    for (const hostname of hostnames) {
      await this.hostnames.delete(hostname);
    }

    // Update worker config to remove hostnames
    const currentHostnames = worker.config.hostnames ?? [];
    const remainingHostnames = currentHostnames.filter((h) => !hostnames.includes(h));
    if (remainingHostnames.length !== currentHostnames.length) {
      await this.workers.put(tenantId, workerId, {
        ...worker,
        config: { ...worker.config, hostnames: remainingHostnames },
      });
    }
  }

  /**
   * Get hostnames for a worker
   */
  async getHostnames(tenantId: string, workerId: string): Promise<string[]> {
    return this.hostnames.listByWorker(tenantId, workerId);
  }

  /**
   * Resolve a hostname to its worker route
   */
  async resolveHostname(hostname: string): Promise<HostnameRoute | null> {
    return this.hostnames.get(hostname);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Merge configuration from global defaults → tenant → worker
   * Later values override earlier ones (except arrays which concatenate).
   */
  private mergeConfig(tenant: TenantRecord, worker: WorkerRecord): {
    env: Record<string, string>;
    compatibilityDate: string;
    compatibilityFlags: string[];
    limits?: WorkerLimits;
    tails: TailWorker[];
  } {
    // Env: merge all three levels (global → tenant → worker)
    const env = {
      ...this._defaults.env,
      ...tenant.config.env,
      ...worker.config.env,
    };

    // Compat date: worker → tenant → global (first defined wins)
    const compatibilityDate =
      worker.config.compatibilityDate ??
      tenant.config.compatibilityDate ??
      this._defaults.compatibilityDate ??
      '2024-12-01';

    // Compat flags: concatenate all (dedupe)
    const compatibilityFlags = [
      ...new Set([
        ...(this._defaults.compatibilityFlags ?? []),
        ...(tenant.config.compatibilityFlags ?? []),
        ...(worker.config.compatibilityFlags ?? []),
      ]),
    ];

    // Limits: merge all three levels (global → tenant → worker)
    const limits: WorkerLimits | undefined =
      this._defaults.limits || tenant.config.limits || worker.config.limits
        ? {
            ...this._defaults.limits,
            ...tenant.config.limits,
            ...worker.config.limits,
          }
        : undefined;

    // Tails: concatenate all levels (all tail workers receive events)
    const tails: TailWorker[] = [
      ...(this._defaults.tails ?? []),
      ...(tenant.config.tails ?? []),
      ...(worker.config.tails ?? []),
    ];

    return { env, compatibilityDate, compatibilityFlags, limits, tails };
  }

  /**
   * Get or create a worker stub, merging global → tenant → worker config
   */
  async getStub(tenantId: string, workerId: string, options?: WorkerOptions): Promise<WorkerStub> {
    const cacheKey = `${tenantId}:${workerId}`;
    
    const [tenant, worker] = await Promise.all([
      this.tenants.get(tenantId),
      this.workers.get(tenantId, workerId),
    ]);

    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }
    if (!worker) {
      throw new Error(`Worker "${workerId}" not found for tenant "${tenantId}"`);
    }

    // Check cache
    const cached = this.stubCache.get(cacheKey);
    if (cached && cached.version === worker.metadata.version) {
      return cached.stub;
    }

    // Merge: global defaults → tenant config → worker config
    const merged = this.mergeConfig(tenant, worker);

    // Build and load
    const loaderName = `${tenantId}:${workerId}:v${worker.metadata.version}`;
    const stub = this.loader.get(loaderName, async () => {
      const result = await buildWorker(worker.config.files, options?.build);
      return {
        mainModule: result.mainModule,
        modules: result.modules as Record<string, string>,
        compatibilityDate: merged.compatibilityDate,
        compatibilityFlags: merged.compatibilityFlags,
        env: merged.env,
        limits: merged.limits,
        globalOutbound: this.outbound ?? null,
        tails: merged.tails,
      };
    });

    this.stubCache.set(cacheKey, { version: worker.metadata.version, stub });
    return stub;
  }

  /**
   * Execute a worker's fetch handler
   */
  async fetch(
    tenantId: string,
    workerId: string,
    request: Request,
    options?: WorkerOptions & { entrypoint?: string }
  ): Promise<Response> {
    const stub = await this.getStub(tenantId, workerId, options);
    return stub.getEntrypoint(options?.entrypoint).fetch(request);
  }

  /**
   * Route a request based on hostname
   * 
   * Looks up the hostname from the request and routes to the associated worker.
   * Returns null if no worker is registered for the hostname.
   * 
   * @example
   * ```ts
   * const response = await platform.route(request);
   * if (!response) {
   *   return new Response('Not found', { status: 404 });
   * }
   * return response;
   * ```
   */
  async route(request: Request, options?: WorkerOptions): Promise<Response | null> {
    const url = new URL(request.url);
    const route = await this.hostnames.get(url.hostname);
    
    if (!route) {
      return null;
    }

    return this.fetch(route.tenantId, route.workerId, request, options);
  }

  /**
   * Quick worker creation and execution (ephemeral, not persisted)
   * 
   * Creates a worker with global + tenant defaults but doesn't save it.
   * Useful for one-off executions or testing.
   */
  async runEphemeral(
    tenantId: string,
    files: Files,
    request: Request,
    options?: WorkerOptions & { 
      env?: Record<string, string>;
      limits?: WorkerLimits;
    }
  ): Promise<Response> {
    const tenant = await this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    // Merge: global → tenant → options
    const env = {
      ...this._defaults.env,
      ...tenant.config.env,
      ...options?.env,
    };

    const compatibilityDate =
      tenant.config.compatibilityDate ??
      this._defaults.compatibilityDate ??
      '2024-12-01';

    const compatibilityFlags = [
      ...new Set([
        ...(this._defaults.compatibilityFlags ?? []),
        ...(tenant.config.compatibilityFlags ?? []),
      ]),
    ];

    const limits: WorkerLimits | undefined =
      this._defaults.limits || tenant.config.limits || options?.limits
        ? {
            ...this._defaults.limits,
            ...tenant.config.limits,
            ...options?.limits,
          }
        : undefined;

    // Tails: concatenate global + tenant (ephemeral workers don't have their own tails)
    const tails: TailWorker[] = [
      ...(this._defaults.tails ?? []),
      ...(tenant.config.tails ?? []),
    ];

    const result = await buildWorker(files, options?.build);
    const loaderName = `${tenantId}:ephemeral:${Date.now()}`;
    
    const stub = this.loader.get(loaderName, async () => ({
      mainModule: result.mainModule,
      modules: result.modules as Record<string, string>,
      compatibilityDate,
      compatibilityFlags,
      env,
      limits,
      globalOutbound: this.outbound ?? null,
      tails,
    }));

    return stub.getEntrypoint().fetch(request);
  }
}

export type { TenantConfig, TenantMetadata, TenantRecord, TenantStorage };
export type { WorkerConfig, WorkerMetadata, WorkerRecord, WorkerStorage, WorkerOptions };
export type { WorkerDefaults, WorkerLimits };
export type { HostnameStorage, HostnameRoute };
