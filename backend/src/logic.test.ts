import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import { formatMon } from "./format.js";
import { Indexer } from "./indexer.js";
import type { ChainReader } from "./indexer.js";
import { applyEvents } from "./processor.js";
import type { ChainEvent, PaymentReceivedEvent, RequestCreatedEvent } from "./processor.js";
import { buildSeed } from "./seed.js";
import { revenueSeries, summarize, topClients } from "./stats.js";
import { MemoryStore } from "./store.js";
import { emptyRequest } from "./types.js";
import type { PaymentRequest } from "./types.js";

const MON = 10n ** 18n;
const A = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const B = "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb";
const tx = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const created = (id: number, block: number, ts: number, amount = MON): RequestCreatedEvent => ({
  name: "RequestCreated", id: BigInt(id), creator: A, amount, concept: `Concepto ${id}`,
  txHash: tx(id), blockNumber: BigInt(block), logIndex: 0, timestamp: ts,
});
const paid = (id: number, block: number, ts: number, amount = MON): PaymentReceivedEvent => ({
  name: "PaymentReceived", id: BigInt(id), creator: A, payer: B, amount,
  txHash: tx(1000 + id), blockNumber: BigInt(block), logIndex: 1, timestamp: ts,
});

function row(over: Partial<PaymentRequest> & { id: string }): PaymentRequest {
  return { ...emptyRequest(over.id), creator: A.toLowerCase(), ...over };
}

describe("formatMon", () => {
  it("formatea wei a MON sin perder precisión", () => {
    assert.equal(formatMon(0n), "0");
    assert.equal(formatMon(MON), "1");
    assert.equal(formatMon(1_500_000_000_000_000_000n), "1.5");
    assert.equal(formatMon(123_456_789_000_000_000_000n), "123.456789");
    assert.equal(formatMon(10n ** 30n), "1000000000000");
  });
});

describe("processor", () => {
  it("PaymentReceived antes que RequestCreated termina igual (orden irrelevante)", async () => {
    const t0 = 1_760_000_000;
    const inOrder = new MemoryStore();
    await applyEvents(inOrder, [created(1, 10, t0), paid(1, 12, t0 + 60)]);

    const reversed = new MemoryStore();
    // Se aplican por separado, en orden inverso, como si llegaran de /sync y del indexador.
    await applyEvents(reversed, [paid(1, 12, t0 + 60)]);
    await applyEvents(reversed, [created(1, 10, t0)]);

    const a = await inOrder.getRequest("1");
    const b = await reversed.getRequest("1");
    assert.deepEqual(a, b);
    assert.equal(a?.status, "paid");
    assert.equal(a?.concept, "Concepto 1");
    assert.equal(a?.creator, A.toLowerCase());
    assert.equal(a?.payer, B.toLowerCase());
  });

  it("solo se marca pagada con el evento on-chain y es idempotente", async () => {
    const store = new MemoryStore();
    await applyEvents(store, [created(7, 5, 1_760_000_000)]);
    assert.equal((await store.getRequest("7"))?.status, "pending");
    await applyEvents(store, [paid(7, 6, 1_760_000_100)]);
    await applyEvents(store, [paid(7, 6, 1_760_000_100), created(7, 5, 1_760_000_000)]);
    const r = await store.getRequest("7");
    assert.equal(r?.status, "paid");
    assert.equal(r?.paidAt, new Date(1_760_000_100 * 1000).toISOString());
  });

  it("no pisa metadatos off-chain al reprocesar RequestCreated", async () => {
    const store = new MemoryStore();
    await applyEvents(store, [created(3, 5, 1_760_000_000)]);
    await store.upsertRequest("3", { clientName: "Marta Rojas", category: "Diseño" });
    await applyEvents(store, [created(3, 5, 1_760_000_000)]);
    const r = await store.getRequest("3");
    assert.equal(r?.clientName, "Marta Rojas");
    assert.equal(r?.category, "Diseño");
  });
});

describe("stats", () => {
  const now = Date.parse("2026-10-17T18:00:00Z");
  const iso = (s: string) => new Date(s).toISOString();
  const rows = [
    row({ id: "1", amountWei: (2n * MON).toString(), status: "paid", clientName: "Studio Andina",
      createdAt: iso("2026-10-16T10:00:00Z"), paidAt: iso("2026-10-16T11:00:00Z") }),
    row({ id: "2", amountWei: (4n * MON).toString(), status: "paid", clientName: "studio andina ",
      createdAt: iso("2026-10-10T10:00:00Z"), paidAt: iso("2026-10-10T12:00:00Z") }),
    row({ id: "3", amountWei: (1n * MON).toString(), status: "paid", payer: B.toLowerCase(),
      createdAt: iso("2026-09-01T10:00:00Z"), paidAt: iso("2026-09-01T10:30:00Z") }),
    row({ id: "4", amountWei: (10n * MON).toString(), status: "pending", createdAt: iso("2026-10-15T10:00:00Z") }),
  ];

  it("resumen: totales, conversión, ticket promedio y tiempo de pago", () => {
    const s = summarize(rows, now);
    assert.equal(s.totalRevenueMon, "7");
    assert.equal(s.requestsCreated, 4);
    assert.equal(s.requestsPaid, 3);
    assert.equal(s.requestsPending, 1);
    assert.equal(s.conversionRate, 0.75);
    assert.equal(s.avgTicketWei, ((7n * MON) / 3n).toString());
    assert.equal(s.pendingAmountMon, "10");
    assert.equal(s.revenueLast7dMon, "2"); // solo la del 16-oct
    assert.equal(s.revenueLast30dMon, "6"); // 16-oct y 10-oct (la del 1-sep queda fuera)
    // (3600 + 7200 + 1800) / 3 = 4200 s
    assert.equal(s.avgPaymentTimeSeconds, 4200);
  });

  it("resumen sin datos no divide por cero", () => {
    const s = summarize([], now);
    assert.equal(s.conversionRate, 0);
    assert.equal(s.avgTicketWei, "0");
    assert.equal(s.avgPaymentTimeSeconds, null);
  });

  it("serie diaria: rellena días vacíos y usa hora de Colombia (UTC-5)", () => {
    const edge = [
      // 2026-10-17 03:00 UTC = 2026-10-16 22:00 en Bogotá -> cae en el día 16
      row({ id: "9", amountWei: MON.toString(), status: "paid", paidAt: iso("2026-10-17T03:00:00Z") }),
    ];
    const s = revenueSeries(edge, {
      period: "day",
      fromMs: Date.parse("2026-10-15T05:00:00Z"),
      toMs: now,
    });
    assert.deepEqual(s.points.map((p) => p.bucket), ["2026-10-15", "2026-10-16", "2026-10-17"]);
    assert.deepEqual(s.points.map((p) => p.revenueMon), ["0", "1", "0"]);
    assert.equal(s.totalMon, "1");
  });

  it("serie semanal (lunes) y mensual", () => {
    const w = revenueSeries(rows, { period: "week", fromMs: Date.parse("2026-10-01T00:00:00Z"), toMs: now });
    // 10-oct (sábado) -> semana del lunes 5; 16-oct (viernes) -> semana del lunes 12
    const byBucket = Object.fromEntries(w.points.map((p) => [p.bucket, p.revenueMon]));
    assert.equal(byBucket["2026-10-05"], "4");
    assert.equal(byBucket["2026-10-12"], "2");
    const m = revenueSeries(rows, { period: "month", fromMs: Date.parse("2026-09-01T12:00:00Z"), toMs: now });
    assert.deepEqual(m.points.map((p) => [p.bucket, p.revenueMon]), [["2026-09-01", "1"], ["2026-10-01", "6"]]);
  });

  it("mejores clientes: agrupa sin distinguir mayúsculas y ordena por total", () => {
    const c = topClients(rows, 10);
    assert.equal(c[0]!.client, "Studio Andina");
    assert.equal(c[0]!.totalMon, "6");
    assert.equal(c[0]!.payments, 2);
    assert.equal(c[1]!.client, B.toLowerCase()); // sin nombre: se usa la wallet pagadora
    assert.equal(topClients(rows, 1).length, 1);
  });
});

describe("indexador", () => {
  function fakeChain(head: bigint, events: ChainEvent[]) {
    const calls: Array<[bigint, bigint]> = [];
    const reader: ChainReader = {
      getHead: async () => head,
      getEvents: async (from, to) => {
        calls.push([from, to]);
        return events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
      },
    };
    return { reader, calls };
  }
  const opts = { deployBlock: 1n, chunkSize: 100n, pollIntervalMs: 1000, confirmations: 0n };

  it("se pone al día en trozos y guarda last_block", async () => {
    const store = new MemoryStore();
    const { reader, calls } = fakeChain(250n, [created(1, 5, 1_760_000_000), paid(1, 230, 1_760_000_500)]);
    const n = await new Indexer(store, reader, opts).runOnce();
    assert.equal(n, 2);
    assert.deepEqual(calls, [[1n, 100n], [101n, 200n], [201n, 250n]]);
    assert.equal(await store.getLastBlock(), 250n);
    assert.equal((await store.getRequest("1"))?.status, "paid");
  });

  it("retoma desde last_block + 1 y respeta las confirmaciones", async () => {
    const store = new MemoryStore();
    await store.setLastBlock(250n);
    const { reader, calls } = fakeChain(300n, []);
    await new Indexer(store, reader, { ...opts, confirmations: 2n }).runOnce();
    assert.deepEqual(calls, [[251n, 298n]]);
    assert.equal(await store.getLastBlock(), 298n);
  });

  it("si el RPC falla no avanza last_block (reintenta el mismo trozo)", async () => {
    const store = new MemoryStore();
    let fail = true;
    const reader: ChainReader = {
      getHead: async () => 50n,
      getEvents: async () => {
        if (fail) throw new Error("rpc caído");
        return [created(1, 10, 1_760_000_000)];
      },
    };
    const idx = new Indexer(store, reader, opts);
    await assert.rejects(idx.runOnce(), /rpc caído/);
    assert.equal(await store.getLastBlock(), null);
    fail = false;
    assert.equal(await idx.runOnce(), 1);
    assert.equal(await store.getLastBlock(), 50n);
  });
});

describe("config y datos mock", () => {
  it("modo mock no exige contrato ni Supabase", () => {
    const cfg = loadConfig({ USE_MOCK: "true" });
    assert.equal(cfg.useMock, true);
    assert.equal(cfg.chainId, 10143);
  });

  it("modo live valida todo y lista todos los problemas", () => {
    assert.throws(() => loadConfig({ USE_MOCK: "false" }), (e: Error) =>
      /CONTRACT_ADDRESS/.test(e.message) && /DEPLOY_BLOCK/.test(e.message) &&
      /SUPABASE_URL/.test(e.message) && /SUPABASE_SERVICE_ROLE_KEY/.test(e.message));
    const ok = loadConfig({
      USE_MOCK: "false", CONTRACT_ADDRESS: A, DEPLOY_BLOCK: "123",
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k",
    });
    assert.equal(ok.deployBlock, 123n);
  });

  it("la semilla es determinista y mezcla pagadas y pendientes", () => {
    const now = Date.parse("2026-10-17T18:00:00Z");
    const a = buildSeed(now);
    assert.deepEqual(a, buildSeed(now));
    assert.ok(a.some((r) => r.status === "paid") && a.some((r) => r.status === "pending"));
    assert.ok(a.every((r) => r.status === "pending" || (r.paidAt && r.paidTx && r.payer)));
  });
});
