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
  KVBundleStorage,
  KVTemplateStorage,
  MemoryTenantStorage,
  MemoryWorkerStorage,
  MemoryHostnameStorage,
  MemoryBundleStorage,
  MemoryTemplateStorage,
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
  BundleStorage,
  WorkerBundle,
  TemplateStorage,
  TemplateConfig,
  TemplateMetadata,
  TemplateRecord,
  TemplateSlotValues,
  CreateFromTemplateOptions,
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
  /** Bundle storage for pre-built worker modules (defaults to KV or memory) */
  bundleStorage?: BundleStorage;
  /** Template storage (defaults to KV or memory) */
  templateStorage?: TemplateStorage;
  /** KV namespace for tenant storage */
  tenantsKV?: KVNamespace;
  /** KV namespace for worker storage (also used for bundles/templates if not provided) */
  workersKV?: KVNamespace;
  /** KV namespace for hostname routing */
  hostnamesKV?: KVNamespace;
  /** KV namespace for bundle storage (defaults to workersKV) */
  bundlesKV?: KVNamespace;
  /** KV namespace for template storage (defaults to workersKV) */
  templatesKV?: KVNamespace;
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
  public readonly bundles: BundleStorage;
  public readonly templates: TemplateStorage;
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

    // Initialize bundle storage (defaults to workersKV if not specified)
    if (options.bundleStorage) {
      this.bundles = options.bundleStorage;
    } else if (options.bundlesKV) {
      this.bundles = new KVBundleStorage(options.bundlesKV);
    } else if (options.workersKV) {
      this.bundles = new KVBundleStorage(options.workersKV);
    } else {
      this.bundles = new MemoryBundleStorage();
    }

    // Initialize template storage (defaults to workersKV if not specified)
    if (options.templateStorage) {
      this.templates = options.templateStorage;
    } else if (options.templatesKV) {
      this.templates = new KVTemplateStorage(options.templatesKV);
    } else if (options.workersKV) {
      this.templates = new KVTemplateStorage(options.workersKV);
    } else {
      this.templates = new MemoryTemplateStorage();
    }

    // Global defaults (fallback values)
    this._defaults = {
      env: options.defaults?.env ?? {},
      compatibilityDate: options.defaults?.compatibilityDate ?? '2026-01-24',
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
   * 
   * Builds the worker once and stores the bundle in KV for fast cold starts.
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

    // Build the worker and validate it compiles
    const buildResult = await buildWorker(config.files, options?.build);

    const now = new Date().toISOString();
    const version = 1;
    const metadata: WorkerMetadata = {
      id: config.id,
      tenantId,
      createdAt: now,
      updatedAt: now,
      version,
    };

    // Store the pre-built bundle
    const bundle: WorkerBundle = {
      mainModule: buildResult.mainModule,
      modules: buildResult.modules as Record<string, string>,
      version,
      builtAt: now,
    };
    await this.bundles.put(tenantId, config.id, version, bundle);

    // Store worker config (without needing to rebuild on fetch)
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
   * 
   * Rebuilds the worker and stores the new bundle in KV.
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

    // Build the worker and validate it compiles
    const buildResult = await buildWorker(config.files, options?.build);

    const now = new Date().toISOString();
    const newVersion = existing.metadata.version + 1;
    const metadata: WorkerMetadata = {
      ...existing.metadata,
      updatedAt: now,
      version: newVersion,
    };

    // Store the new pre-built bundle
    const bundle: WorkerBundle = {
      mainModule: buildResult.mainModule,
      modules: buildResult.modules as Record<string, string>,
      version: newVersion,
      builtAt: now,
    };
    await this.bundles.put(tenantId, workerId, newVersion, bundle);

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
    // Delete associated hostnames and bundles
    await Promise.all([
      this.hostnames.deleteByWorker(tenantId, workerId),
      this.bundles.deleteAll(tenantId, workerId),
    ]);
    return this.workers.delete(tenantId, workerId);
  }

  /**
   * List all workers for a tenant
   */
  async listWorkers(tenantId: string, options?: { limit?: number; cursor?: string }) {
    return this.workers.list(tenantId, options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Templates
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a template that tenants can use to create workers.
   * 
   * Templates define the worker structure with {{slot}} placeholders that
   * tenants fill in with their custom code.
   * 
   * @example
   * ```ts
   * await platform.registerTemplate({
   *   id: 'webhook-handler',
   *   name: 'Webhook Handler',
   *   description: 'Process incoming webhooks',
   *   files: {
   *     'src/index.ts': `
   *       export default {
   *         async fetch(request: Request, env: Env) {
   *           const payload = await request.json();
   *           {{handlePayload}}
   *           return new Response('OK');
   *         }
   *       }
   *     `,
   *   },
   *   slots: [
   *     {
   *       name: 'handlePayload',
   *       description: 'Process the webhook payload',
   *       example: 'console.log(payload);',
   *       required: true,
   *     },
   *   ],
   *   defaults: {
   *     env: { WEBHOOK_SECRET: '' },
   *   },
   * });
   * ```
   */
  async registerTemplate(config: TemplateConfig): Promise<TemplateMetadata> {
    const existing = await this.templates.get(config.id);
    if (existing) {
      throw new Error(`Template "${config.id}" already exists`);
    }

    // Validate that all slots referenced in files are defined
    const referencedSlots = this.extractSlotNames(config.files);
    const definedSlots = new Set(config.slots.map((s) => s.name));
    for (const slot of referencedSlots) {
      if (!definedSlots.has(slot)) {
        throw new Error(`Slot "{{${slot}}}" used in files but not defined in slots array`);
      }
    }

    const now = new Date().toISOString();
    const metadata: TemplateMetadata = {
      id: config.id,
      name: config.name,
      description: config.description,
      slotNames: config.slots.map((s) => s.name),
      createdAt: now,
      updatedAt: now,
    };

    await this.templates.put(config.id, { metadata, config });
    return metadata;
  }

  /**
   * Update an existing template
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<Omit<TemplateConfig, 'id'>>
  ): Promise<TemplateMetadata> {
    const existing = await this.templates.get(templateId);
    if (!existing) {
      throw new Error(`Template "${templateId}" not found`);
    }

    const config: TemplateConfig = {
      ...existing.config,
      ...updates,
      id: templateId,
    };

    // Validate slots if files or slots changed
    if (updates.files || updates.slots) {
      const referencedSlots = this.extractSlotNames(config.files);
      const definedSlots = new Set(config.slots.map((s) => s.name));
      for (const slot of referencedSlots) {
        if (!definedSlots.has(slot)) {
          throw new Error(`Slot "{{${slot}}}" used in files but not defined in slots array`);
        }
      }
    }

    const metadata: TemplateMetadata = {
      ...existing.metadata,
      name: config.name,
      description: config.description,
      slotNames: config.slots.map((s) => s.name),
      updatedAt: new Date().toISOString(),
    };

    await this.templates.put(templateId, { metadata, config });
    return metadata;
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<TemplateRecord | null> {
    return this.templates.get(templateId);
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    return this.templates.delete(templateId);
  }

  /**
   * List all templates
   */
  async listTemplates(options?: { limit?: number; cursor?: string }) {
    return this.templates.list(options);
  }

  /**
   * Create a worker from a template by filling in the slot values.
   * 
   * @example
   * ```ts
   * await platform.createWorkerFromTemplate('acme', 'webhook-handler', {
   *   workerId: 'github-webhooks',
   *   slots: {
   *     handlePayload: `
   *       if (payload.action === 'push') {
   *         await env.QUEUE.send(payload);
   *       }
   *     `,
   *   },
   *   overrides: {
   *     env: { WEBHOOK_SECRET: 'my-secret' },
   *   },
   * });
   * ```
   */
  async createWorkerFromTemplate(
    tenantId: string,
    templateId: string,
    options: CreateFromTemplateOptions
  ): Promise<WorkerMetadata> {
    const template = await this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template "${templateId}" not found`);
    }

    // Interpolate slots into files
    const files = this.interpolateTemplate(template.config, options.slots);

    // Merge defaults: template defaults → overrides
    const mergedConfig: Omit<WorkerConfig, 'id' | 'tenantId' | 'files'> = {
      env: { ...template.config.defaults?.env, ...options.overrides?.env },
      compatibilityDate: options.overrides?.compatibilityDate ?? template.config.defaults?.compatibilityDate,
      compatibilityFlags: options.overrides?.compatibilityFlags ?? template.config.defaults?.compatibilityFlags,
      limits: options.overrides?.limits ?? template.config.defaults?.limits,
      tails: options.overrides?.tails ?? template.config.defaults?.tails,
      hostnames: options.overrides?.hostnames,
    };

    // Create the worker
    return this.createWorker(
      tenantId,
      {
        id: options.workerId,
        files,
        ...mergedConfig,
      },
      { build: options.build }
    );
  }

  /**
   * Preview what files would be generated from a template without creating a worker.
   * Useful for validation or showing tenants what their code will look like.
   */
  previewTemplateFiles(template: TemplateConfig, slots: TemplateSlotValues): Files {
    return this.interpolateTemplate(template, slots);
  }

  /**
   * Extract slot names from template files (finds all {{slotName}} patterns)
   */
  private extractSlotNames(files: Files): Set<string> {
    const slotPattern = /\{\{(\w+)\}\}/g;
    const slots = new Set<string>();
    
    for (const content of Object.values(files)) {
      let match;
      while ((match = slotPattern.exec(content)) !== null) {
        slots.add(match[1]);
      }
    }
    
    return slots;
  }

  /**
   * Interpolate slot values into template files
   */
  private interpolateTemplate(template: TemplateConfig, slotValues: TemplateSlotValues): Files {
    const files: Files = {};
    
    // Build a map of slot name → value (with defaults)
    const values: Record<string, string> = {};
    for (const slot of template.slots) {
      values[slot.name] = slotValues[slot.name] ?? slot.default;
    }
    
    // Replace {{slotName}} in each file
    for (const [path, content] of Object.entries(template.files)) {
      let interpolated = content;
      for (const [name, value] of Object.entries(values)) {
        interpolated = interpolated.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), value);
      }
      files[path] = interpolated;
    }
    
    return files;
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
      '2026-01-24';

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
   * 
   * The loader callback only runs on cold starts - it fetches the pre-built
   * bundle from KV instead of rebuilding the worker.
   */
  async getStub(tenantId: string, workerId: string, _options?: WorkerOptions): Promise<WorkerStub> {
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
    const version = worker.metadata.version;

    // Load worker - the callback only runs on cold starts
    // It fetches the pre-built bundle from KV (fast) instead of rebuilding (slow)
    const loaderName = `${tenantId}:${workerId}:v${version}`;
    const bundles = this.bundles; // Capture for closure
    const outbound = this.outbound;

    const stub = this.loader.get(loaderName, async () => {
      // Fetch pre-built bundle from KV
      const bundle = await bundles.get(tenantId, workerId, version);
      if (!bundle) {
        throw new Error(`Bundle not found for ${tenantId}/${workerId} v${version}`);
      }

      return {
        mainModule: bundle.mainModule,
        modules: bundle.modules,
        compatibilityDate: merged.compatibilityDate,
        compatibilityFlags: merged.compatibilityFlags,
        env: merged.env,
        limits: merged.limits,
        globalOutbound: outbound ?? null,
        tails: merged.tails,
      };
    });

    this.stubCache.set(cacheKey, { version, stub });
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
      '2026-01-24';

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
