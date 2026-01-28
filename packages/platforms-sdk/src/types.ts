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
 * Pre-built worker bundle stored in KV
 * This is built once on upload and fetched on cold starts
 */
export interface WorkerBundle {
  /** Main module entry point */
  mainModule: string;
  /** Compiled modules */
  modules: Modules;
  /** Version this bundle was built for */
  version: number;
  /** When the bundle was built */
  builtAt: string;
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
 * Storage interface for pre-built worker bundles
 */
export interface BundleStorage {
  /** Get a bundle by versioned key */
  get(tenantId: string, workerId: string, version: number): Promise<WorkerBundle | null>;
  /** Store a bundle with versioned key */
  put(tenantId: string, workerId: string, version: number, bundle: WorkerBundle): Promise<void>;
  /** Delete a specific version */
  delete(tenantId: string, workerId: string, version: number): Promise<boolean>;
  /** Delete all bundles for a worker */
  deleteAll(tenantId: string, workerId: string): Promise<number>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A slot where tenant code gets interpolated into template files.
 * 
 * Slots are defined with a placeholder syntax: {{slotName}}
 * When creating a worker from a template, tenants provide values for each slot.
 */
export interface TemplateSlot {
  /** Unique name for this slot (used as {{name}} in files) */
  name: string;
  /** Human-readable description of what code should go here */
  description: string;
  /** Default value used when tenant doesn't provide one */
  default: string;
  /** Example code to help tenants understand what to provide */
  example?: string;
}

/**
 * Template definition - pre-defined worker structure with slots for tenant code.
 * 
 * Templates let platform owners define the worker scaffolding while tenants
 * only provide small pieces of business logic.
 * 
 * @example
 * ```ts
 * const template: TemplateConfig = {
 *   id: 'webhook-handler',
 *   name: 'Webhook Handler',
 *   description: 'Process incoming webhooks with custom validation and handling',
 *   files: {
 *     'src/index.ts': `
 *       import { validateSignature } from './utils';
 *       
 *       export default {
 *         async fetch(request: Request, env: Env) {
 *           if (!validateSignature(request, env.WEBHOOK_SECRET)) {
 *             return new Response('Invalid signature', { status: 401 });
 *           }
 *           const payload = await request.json();
 *           
 *           // Tenant's custom handler
 *           {{handleWebhook}}
 *           
 *           return new Response('OK');
 *         }
 *       }
 *     `,
 *     'src/utils.ts': '...',
 *   },
 *   slots: [
 *     {
 *       name: 'handleWebhook',
 *       description: 'Process the webhook payload',
 *       example: 'console.log("Received:", payload);',
 *       required: true,
 *     },
 *   ],
 *   defaults: {
 *     env: { WEBHOOK_SECRET: '' },
 *   },
 * };
 * ```
 */
export interface TemplateConfig {
  /** Unique identifier for this template */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this template does */
  description: string;
  /** Template files with {{slot}} placeholders */
  files: Files;
  /** Slots that tenants fill in with their code */
  slots: TemplateSlot[];
  /** Default worker configuration (can be overridden by tenant/worker) */
  defaults?: WorkerDefaults;
}

/**
 * Metadata for a template
 */
export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  slotNames: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Full template record
 */
export interface TemplateRecord {
  metadata: TemplateMetadata;
  config: TemplateConfig;
}

/**
 * Values provided by tenant to fill template slots
 */
export type TemplateSlotValues = Record<string, string>;

/**
 * Options for creating a worker from a template
 */
export interface CreateFromTemplateOptions {
  /** Worker ID */
  workerId: string;
  /** Values to fill in template slots */
  slots: TemplateSlotValues;
  /** Override template defaults */
  overrides?: Partial<Omit<WorkerConfig, 'id' | 'tenantId' | 'files'>>;
  /** Build options */
  build?: BuildOptions;
}

/**
 * Storage interface for templates
 */
export interface TemplateStorage {
  get(templateId: string): Promise<TemplateRecord | null>;
  put(templateId: string, record: TemplateRecord): Promise<void>;
  delete(templateId: string): Promise<boolean>;
  list(options?: { limit?: number; cursor?: string }): Promise<{
    templates: TemplateMetadata[];
    cursor?: string;
  }>;
}
