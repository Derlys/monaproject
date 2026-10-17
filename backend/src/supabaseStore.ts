import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery, Store } from "./store.js";
import type { PaymentRequest, RequestPatch } from "./types.js";

const TABLE = "payment_requests";
const STATE_TABLE = "indexer_state";
const PAGE = 1000; // máximo de filas por consulta en PostgREST

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const toIso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);

function fromRow(r: Row): PaymentRequest {
  return {
    id: String(r.id),
    creator: r.creator ?? null,
    payer: r.payer ?? null,
    amountWei: r.amount_wei ?? null,
    concept: r.concept ?? null,
    status: r.status === "paid" ? "paid" : "pending",
    clientName: r.client_name ?? null,
    category: r.category ?? null,
    createdTx: r.created_tx ?? null,
    createdBlock: toStr(r.created_block),
    createdAt: toIso(r.created_at),
    paidTx: r.paid_tx ?? null,
    paidBlock: toStr(r.paid_block),
    paidAt: toIso(r.paid_at),
  };
}

const COLUMN: Record<keyof RequestPatch, string> = {
  creator: "creator",
  payer: "payer",
  amountWei: "amount_wei",
  concept: "concept",
  status: "status",
  clientName: "client_name",
  category: "category",
  createdTx: "created_tx",
  createdBlock: "created_block",
  createdAt: "created_at",
  paidTx: "paid_tx",
  paidBlock: "paid_block",
  paidAt: "paid_at",
};

function toRow(id: string, patch: RequestPatch): Row {
  // Solo se envían las claves definidas: PostgREST actualiza únicamente esas columnas
  // en el ON CONFLICT, así que un evento no pisa los datos que aportó otro.
  const row: Row = { id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(patch) as [keyof RequestPatch, unknown][]) {
    if (value !== undefined) row[COLUMN[key]] = value;
  }
  return row;
}

function fail(action: string, error: { message: string } | null): void {
  if (error) throw new Error(`Supabase (${action}): ${error.message}`);
}

export class SupabaseStore implements Store {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async upsertRequest(id: string, patch: RequestPatch): Promise<void> {
    const { error } = await this.db.from(TABLE).upsert(toRow(id, patch), { onConflict: "id" });
    fail("upsert", error);
  }

  async getRequest(id: string): Promise<PaymentRequest | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    fail("get", error);
    return data ? fromRow(data as Row) : null;
  }

  async listRequests(query: ListQuery) {
    // Se excluyen filas sin datos on-chain (amount_wei nulo).
    let q = this.db.from(TABLE).select("*", { count: "exact" }).not("amount_wei", "is", null);
    if (query.creator) q = q.eq("creator", query.creator);
    if (query.status) q = q.eq("status", query.status);
    const { data, error, count } = await q
      .order("id", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);
    fail("list", error);
    return { items: (data ?? []).map((r) => fromRow(r as Row)), total: count ?? 0 };
  }

  async allByCreator(creator: string): Promise<PaymentRequest[]> {
    const out: PaymentRequest[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from(TABLE)
        .select("*")
        .eq("creator", creator)
        .not("amount_wei", "is", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      fail("allByCreator", error);
      const batch = data ?? [];
      out.push(...batch.map((r) => fromRow(r as Row)));
      if (batch.length < PAGE) return out;
    }
  }

  async getLastBlock(): Promise<bigint | null> {
    const { data, error } = await this.db.from(STATE_TABLE).select("last_block").eq("id", 1).maybeSingle();
    fail("getLastBlock", error);
    return data ? BigInt((data as Row).last_block) : null;
  }

  async setLastBlock(block: bigint): Promise<void> {
    const { error } = await this.db
      .from(STATE_TABLE)
      .upsert({ id: 1, last_block: Number(block), updated_at: new Date().toISOString() }, { onConflict: "id" });
    fail("setLastBlock", error);
  }
}
