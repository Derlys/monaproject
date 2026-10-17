import { compareBigIntDesc } from "./format.js";
import { emptyRequest } from "./types.js";
import type { PaymentRequest, RequestPatch, RequestStatus } from "./types.js";

export interface ListQuery {
  creator?: string;
  status?: RequestStatus;
  limit: number;
  offset: number;
}

/** Capa de persistencia. Hay dos implementaciones: MemoryStore (mock/tests) y SupabaseStore. */
export interface Store {
  /** Upsert por id: solo se escriben las claves con valor distinto de `undefined`. */
  upsertRequest(id: string, patch: RequestPatch): Promise<void>;
  getRequest(id: string): Promise<PaymentRequest | null>;
  listRequests(query: ListQuery): Promise<{ items: PaymentRequest[]; total: number }>;
  /** Todas las solicitudes de un creador (para calcular métricas). */
  allByCreator(creator: string): Promise<PaymentRequest[]>;
  getLastBlock(): Promise<bigint | null>;
  setLastBlock(block: bigint): Promise<void>;
}

export interface MemoryStoreOptions {
  /**
   * Modo mock: ignora el filtro `creator` para que cualquier wallet conectada vea los
   * datos de ejemplo. No usar fuera del modo mock.
   */
  anyCreator?: boolean;
}

export class MemoryStore implements Store {
  private rows = new Map<string, PaymentRequest>();
  private lastBlock: bigint | null = null;

  constructor(private readonly options: MemoryStoreOptions = {}) {}

  seed(rows: PaymentRequest[]): void {
    for (const row of rows) this.rows.set(row.id, { ...row });
  }

  async upsertRequest(id: string, patch: RequestPatch): Promise<void> {
    const current = this.rows.get(id) ?? emptyRequest(id);
    const next: PaymentRequest = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    }
    this.rows.set(id, next);
  }

  async getRequest(id: string): Promise<PaymentRequest | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  private filtered(creator?: string, status?: RequestStatus): PaymentRequest[] {
    const useCreator = creator && !this.options.anyCreator ? creator : undefined;
    return [...this.rows.values()]
      .filter((r) => (useCreator ? r.creator === useCreator : true))
      .filter((r) => (status ? r.status === status : true))
      .sort((a, b) => compareBigIntDesc(BigInt(a.id), BigInt(b.id)));
  }

  async listRequests(query: ListQuery) {
    const all = this.filtered(query.creator, query.status);
    return {
      items: all.slice(query.offset, query.offset + query.limit).map((r) => ({ ...r })),
      total: all.length,
    };
  }

  async allByCreator(creator: string): Promise<PaymentRequest[]> {
    return this.filtered(creator).map((r) => ({ ...r }));
  }

  async getLastBlock(): Promise<bigint | null> {
    return this.lastBlock;
  }

  async setLastBlock(block: bigint): Promise<void> {
    this.lastBlock = block;
  }
}
