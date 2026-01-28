/**
 * Storage layer
 * 
 * Default: KV-based storage
 * Customize: Implement TenantStorage/WorkerStorage interfaces
 */

import type {
  TenantStorage,
  TenantRecord,
  TenantMetadata,
  WorkerStorage,
  WorkerRecord,
  WorkerMetadata,
  HostnameStorage,
  HostnameRoute,
  BundleStorage,
  WorkerBundle,
  TemplateStorage,
  TemplateRecord,
  TemplateMetadata,
} from '../types.js';

/**
 * KV-based tenant storage
 */
export class KVTenantStorage implements TenantStorage {
  constructor(private kv: KVNamespace) {}

  async get(tenantId: string): Promise<TenantRecord | null> {
    const data = await this.kv.get(`tenant:${tenantId}`, 'json');
    return data as TenantRecord | null;
  }

  async put(tenantId: string, record: TenantRecord): Promise<void> {
    await this.kv.put(`tenant:${tenantId}`, JSON.stringify(record), {
      metadata: {
        id: record.metadata.id,
        updatedAt: record.metadata.updatedAt,
      },
    });
  }

  async delete(tenantId: string): Promise<boolean> {
    const exists = await this.get(tenantId);
    if (!exists) return false;
    await this.kv.delete(`tenant:${tenantId}`);
    return true;
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    tenants: TenantMetadata[];
    cursor?: string;
  }> {
    const prefix = options?.prefix ? `tenant:${options.prefix}` : 'tenant:';
    const result = await this.kv.list({
      prefix,
      limit: options?.limit ?? 100,
      cursor: options?.cursor,
    });

    const tenants: TenantMetadata[] = result.keys.map((key) => ({
      id: key.name.replace('tenant:', ''),
      ...(key.metadata as Omit<TenantMetadata, 'id'>),
    }));

    return {
      tenants,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }
}

/**
 * KV-based worker storage
 */
export class KVWorkerStorage implements WorkerStorage {
  constructor(private kv: KVNamespace) {}

  private key(tenantId: string, workerId: string): string {
    return `worker:${tenantId}:${workerId}`;
  }

  async get(tenantId: string, workerId: string): Promise<WorkerRecord | null> {
    const data = await this.kv.get(this.key(tenantId, workerId), 'json');
    return data as WorkerRecord | null;
  }

  async put(tenantId: string, workerId: string, record: WorkerRecord): Promise<void> {
    await this.kv.put(this.key(tenantId, workerId), JSON.stringify(record), {
      metadata: {
        id: record.metadata.id,
        tenantId: record.metadata.tenantId,
        updatedAt: record.metadata.updatedAt,
        version: record.metadata.version,
      },
    });
  }

  async delete(tenantId: string, workerId: string): Promise<boolean> {
    const exists = await this.get(tenantId, workerId);
    if (!exists) return false;
    await this.kv.delete(this.key(tenantId, workerId));
    return true;
  }

  async list(tenantId: string, options?: { limit?: number; cursor?: string }): Promise<{
    workers: WorkerMetadata[];
    cursor?: string;
  }> {
    const prefix = `worker:${tenantId}:`;
    const result = await this.kv.list({
      prefix,
      limit: options?.limit ?? 100,
      cursor: options?.cursor,
    });

    const workers: WorkerMetadata[] = result.keys.map((key) => ({
      id: key.name.replace(prefix, ''),
      tenantId,
      ...(key.metadata as Omit<WorkerMetadata, 'id' | 'tenantId'>),
    }));

    return {
      workers,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }

  async deleteAll(tenantId: string): Promise<number> {
    const prefix = `worker:${tenantId}:`;
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const result = await this.kv.list({ prefix, cursor });
      for (const key of result.keys) {
        await this.kv.delete(key.name);
        deleted++;
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return deleted;
  }
}

/**
 * In-memory tenant storage (for dev/testing)
 */
export class MemoryTenantStorage implements TenantStorage {
  private store = new Map<string, TenantRecord>();

  async get(tenantId: string): Promise<TenantRecord | null> {
    return this.store.get(tenantId) ?? null;
  }

  async put(tenantId: string, record: TenantRecord): Promise<void> {
    this.store.set(tenantId, record);
  }

  async delete(tenantId: string): Promise<boolean> {
    return this.store.delete(tenantId);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    tenants: TenantMetadata[];
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? '';
    const entries = Array.from(this.store.entries())
      .filter(([id]) => id.startsWith(prefix))
      .map(([, record]) => record.metadata);

    const limit = options?.limit ?? 100;
    const start = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const tenants = entries.slice(start, start + limit);

    return {
      tenants,
      cursor: start + limit < entries.length ? String(start + limit) : undefined,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * In-memory worker storage (for dev/testing)
 */
export class MemoryWorkerStorage implements WorkerStorage {
  private store = new Map<string, WorkerRecord>();

  private key(tenantId: string, workerId: string): string {
    return `${tenantId}:${workerId}`;
  }

  async get(tenantId: string, workerId: string): Promise<WorkerRecord | null> {
    return this.store.get(this.key(tenantId, workerId)) ?? null;
  }

  async put(tenantId: string, workerId: string, record: WorkerRecord): Promise<void> {
    this.store.set(this.key(tenantId, workerId), record);
  }

  async delete(tenantId: string, workerId: string): Promise<boolean> {
    return this.store.delete(this.key(tenantId, workerId));
  }

  async list(tenantId: string, options?: { limit?: number; cursor?: string }): Promise<{
    workers: WorkerMetadata[];
    cursor?: string;
  }> {
    const prefix = `${tenantId}:`;
    const entries = Array.from(this.store.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => record.metadata);

    const limit = options?.limit ?? 100;
    const start = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const workers = entries.slice(start, start + limit);

    return {
      workers,
      cursor: start + limit < entries.length ? String(start + limit) : undefined,
    };
  }

  async deleteAll(tenantId: string): Promise<number> {
    const prefix = `${tenantId}:`;
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * KV-based hostname storage
 */
export class KVHostnameStorage implements HostnameStorage {
  constructor(private kv: KVNamespace) {}

  async get(hostname: string): Promise<HostnameRoute | null> {
    const data = await this.kv.get(`hostname:${hostname}`, 'json');
    return data as HostnameRoute | null;
  }

  async put(hostname: string, route: HostnameRoute): Promise<void> {
    // Store hostname → route mapping
    await this.kv.put(`hostname:${hostname}`, JSON.stringify(route));
    // Also store reverse index for listing by worker
    await this.kv.put(`hostname-idx:${route.tenantId}:${route.workerId}:${hostname}`, '1');
  }

  async delete(hostname: string): Promise<boolean> {
    const existing = await this.get(hostname);
    if (!existing) return false;
    await this.kv.delete(`hostname:${hostname}`);
    await this.kv.delete(`hostname-idx:${existing.tenantId}:${existing.workerId}:${hostname}`);
    return true;
  }

  async listByWorker(tenantId: string, workerId: string): Promise<string[]> {
    const prefix = `hostname-idx:${tenantId}:${workerId}:`;
    const result = await this.kv.list({ prefix });
    return result.keys.map((key) => key.name.replace(prefix, ''));
  }

  async deleteByWorker(tenantId: string, workerId: string): Promise<number> {
    const hostnames = await this.listByWorker(tenantId, workerId);
    for (const hostname of hostnames) {
      await this.delete(hostname);
    }
    return hostnames.length;
  }
}

/**
 * In-memory hostname storage (for dev/testing)
 */
export class MemoryHostnameStorage implements HostnameStorage {
  private routes = new Map<string, HostnameRoute>();

  async get(hostname: string): Promise<HostnameRoute | null> {
    return this.routes.get(hostname) ?? null;
  }

  async put(hostname: string, route: HostnameRoute): Promise<void> {
    this.routes.set(hostname, route);
  }

  async delete(hostname: string): Promise<boolean> {
    return this.routes.delete(hostname);
  }

  async listByWorker(tenantId: string, workerId: string): Promise<string[]> {
    const hostnames: string[] = [];
    for (const [hostname, route] of this.routes) {
      if (route.tenantId === tenantId && route.workerId === workerId) {
        hostnames.push(hostname);
      }
    }
    return hostnames;
  }

  async deleteByWorker(tenantId: string, workerId: string): Promise<number> {
    const hostnames = await this.listByWorker(tenantId, workerId);
    for (const hostname of hostnames) {
      this.routes.delete(hostname);
    }
    return hostnames.length;
  }

  clear(): void {
    this.routes.clear();
  }
}

/**
 * KV-based bundle storage for pre-built worker modules
 */
export class KVBundleStorage implements BundleStorage {
  constructor(private kv: KVNamespace) {}

  private key(tenantId: string, workerId: string, version: number): string {
    return `bundle:${tenantId}:${workerId}:v${version}`;
  }

  async get(tenantId: string, workerId: string, version: number): Promise<WorkerBundle | null> {
    const data = await this.kv.get(this.key(tenantId, workerId, version), 'json');
    return data as WorkerBundle | null;
  }

  async put(tenantId: string, workerId: string, version: number, bundle: WorkerBundle): Promise<void> {
    await this.kv.put(this.key(tenantId, workerId, version), JSON.stringify(bundle));
  }

  async delete(tenantId: string, workerId: string, version: number): Promise<boolean> {
    const exists = await this.get(tenantId, workerId, version);
    if (!exists) return false;
    await this.kv.delete(this.key(tenantId, workerId, version));
    return true;
  }

  async deleteAll(tenantId: string, workerId: string): Promise<number> {
    const prefix = `bundle:${tenantId}:${workerId}:`;
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const result = await this.kv.list({ prefix, cursor });
      for (const key of result.keys) {
        await this.kv.delete(key.name);
        deleted++;
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return deleted;
  }
}

/**
 * In-memory bundle storage (for dev/testing)
 */
export class MemoryBundleStorage implements BundleStorage {
  private store = new Map<string, WorkerBundle>();

  private key(tenantId: string, workerId: string, version: number): string {
    return `${tenantId}:${workerId}:v${version}`;
  }

  async get(tenantId: string, workerId: string, version: number): Promise<WorkerBundle | null> {
    return this.store.get(this.key(tenantId, workerId, version)) ?? null;
  }

  async put(tenantId: string, workerId: string, version: number, bundle: WorkerBundle): Promise<void> {
    this.store.set(this.key(tenantId, workerId, version), bundle);
  }

  async delete(tenantId: string, workerId: string, version: number): Promise<boolean> {
    return this.store.delete(this.key(tenantId, workerId, version));
  }

  async deleteAll(tenantId: string, workerId: string): Promise<number> {
    const prefix = `${tenantId}:${workerId}:`;
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * KV-based template storage
 */
export class KVTemplateStorage implements TemplateStorage {
  constructor(private kv: KVNamespace) {}

  async get(templateId: string): Promise<TemplateRecord | null> {
    const data = await this.kv.get(`template:${templateId}`, 'json');
    return data as TemplateRecord | null;
  }

  async put(templateId: string, record: TemplateRecord): Promise<void> {
    await this.kv.put(`template:${templateId}`, JSON.stringify(record), {
      metadata: {
        id: record.metadata.id,
        name: record.metadata.name,
        updatedAt: record.metadata.updatedAt,
      },
    });
  }

  async delete(templateId: string): Promise<boolean> {
    const exists = await this.get(templateId);
    if (!exists) return false;
    await this.kv.delete(`template:${templateId}`);
    return true;
  }

  async list(options?: { limit?: number; cursor?: string }): Promise<{
    templates: TemplateMetadata[];
    cursor?: string;
  }> {
    const result = await this.kv.list({
      prefix: 'template:',
      limit: options?.limit ?? 100,
      cursor: options?.cursor,
    });

    const templates: TemplateMetadata[] = [];
    for (const key of result.keys) {
      const record = await this.get(key.name.replace('template:', ''));
      if (record) {
        templates.push(record.metadata);
      }
    }

    return {
      templates,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }
}

/**
 * In-memory template storage (for dev/testing)
 */
export class MemoryTemplateStorage implements TemplateStorage {
  private store = new Map<string, TemplateRecord>();

  async get(templateId: string): Promise<TemplateRecord | null> {
    return this.store.get(templateId) ?? null;
  }

  async put(templateId: string, record: TemplateRecord): Promise<void> {
    this.store.set(templateId, record);
  }

  async delete(templateId: string): Promise<boolean> {
    return this.store.delete(templateId);
  }

  async list(options?: { limit?: number; cursor?: string }): Promise<{
    templates: TemplateMetadata[];
    cursor?: string;
  }> {
    const entries = Array.from(this.store.values()).map((record) => record.metadata);

    const limit = options?.limit ?? 100;
    const start = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const templates = entries.slice(start, start + limit);

    return {
      templates,
      cursor: start + limit < entries.length ? String(start + limit) : undefined,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

export type { 
  TenantStorage, TenantRecord, TenantMetadata, 
  WorkerStorage, WorkerRecord, WorkerMetadata, 
  HostnameStorage, HostnameRoute, 
  BundleStorage, WorkerBundle,
  TemplateStorage, TemplateRecord, TemplateMetadata,
};
