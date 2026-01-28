/**
 * Storage layer - the first "unwrap point"
 * 
 * Default: KV-based storage
 * Unwrap: Implement TenantStorage interface for custom storage (R2, D1, external DB, etc.)
 */

import type { TenantStorage, TenantRecord, TenantMetadata } from '../types.js';

/**
 * KV-based storage implementation
 * 
 * This is the default storage layer. If you need custom storage:
 * 1. Implement the TenantStorage interface
 * 2. Pass your implementation to Platform.create()
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
        version: record.metadata.version,
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
 * In-memory storage for development/testing
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

  /** Clear all stored tenants (useful for testing) */
  clear(): void {
    this.store.clear();
  }
}

export type { TenantStorage, TenantRecord, TenantMetadata };
