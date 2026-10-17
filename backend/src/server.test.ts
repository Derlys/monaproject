import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { HttpError } from "./errors.js";
import type { ChainEvent } from "./processor.js";
import { buildSeed } from "./seed.js";
import { createApp } from "./server.js";
import type { AppDeps } from "./server.js";
import { MemoryStore } from "./store.js";

const CREATOR = "0x" + "c".repeat(40);
const PAYER = "0x" + "d".repeat(40);
const OTHER = "0x" + "e".repeat(40);
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const publicConfig = {
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadvision.com",
  contractAddress: "0x" + "1".repeat(40),
  deployBlock: "1",
};

async function start(deps: Partial<AppDeps> & Pick<AppDeps, "store" | "mode">) {
  const server = createApp({ publicConfig, allowedOrigins: ["http://localhost:3000", "https://*.vercel.app"], ...deps });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("API en modo mock", () => {
  const now = Date.parse("2026-10-17T18:00:00Z");
  let app: Awaited<ReturnType<typeof start>>;
  before(async () => {
    const store = new MemoryStore({ anyCreator: true });
    store.seed(buildSeed(now));
    app = await start({ store, mode: "mock", now: () => now });
  });
  after(() => app.server.close());

  it("GET /health y /config", async () => {
    const h = await json(await fetch(`${app.base}/health`));
    assert.equal(h.status, 200);
    assert.equal(h.body.mode, "mock");
    const c = await json(await fetch(`${app.base}/config`));
    assert.equal(c.body.chainId, 10143);
  });

  it("GET /requests pagina y filtra por estado (ignora el creador en mock)", async () => {
    const all = await json(await fetch(`${app.base}/requests?creator=${OTHER}&limit=5`));
    assert.equal(all.status, 200);
    assert.equal(all.body.items.length, 5);
    assert.equal(all.body.total, 48);
    assert.ok(Number(all.body.items[0].id) > Number(all.body.items[1].id)); // más reciente primero
    const paid = await json(await fetch(`${app.base}/requests?status=paid&limit=100`));
    assert.ok(paid.body.items.length > 0 && paid.body.items.every((r: any) => r.status === "paid"));
    const first = paid.body.items[0];
    assert.ok(first.paidTxUrl.startsWith("https://testnet.monadvision.com/tx/0x"));
    assert.ok(first.amountMon);
  });

  it("GET /requests/:id y 404", async () => {
    assert.equal((await json(await fetch(`${app.base}/requests/1`))).body.id, "1");
    assert.equal((await fetch(`${app.base}/requests/9999`)).status, 404);
  });

  it("validaciones de entrada devuelven 400", async () => {
    assert.equal((await fetch(`${app.base}/requests?status=hack`)).status, 400);
    assert.equal((await fetch(`${app.base}/requests?creator=abc`)).status, 400);
    assert.equal((await fetch(`${app.base}/requests?limit=2.5`)).status, 400);
    assert.equal((await fetch(`${app.base}/stats/summary`)).status, 400);
    assert.equal((await fetch(`${app.base}/stats/revenue?creator=${CREATOR}&period=year`)).status, 400);
    assert.equal((await post(`${app.base}/sync`, { txHash: "0x123" })).status, 400);
    const bad = await fetch(`${app.base}/sync`, { method: "POST", body: "no es json" });
    assert.equal(bad.status, 400);
  });

  it("estadísticas coherentes con la lista", async () => {
    const s = await json(await fetch(`${app.base}/stats/summary?creator=${CREATOR}`));
    assert.equal(s.status, 200);
    assert.equal(s.body.requestsCreated, 48);
    assert.equal(s.body.requestsPaid + s.body.requestsPending, 48);
    const rev = await json(await fetch(`${app.base}/stats/revenue?creator=${CREATOR}&period=day`));
    assert.equal(rev.body.points.length, 30);
    assert.equal(rev.body.points.at(-1).bucket, "2026-10-17");
    const sum = rev.body.points.reduce((acc: bigint, p: any) => acc + BigInt(p.revenueWei), 0n);
    assert.equal(sum.toString(), rev.body.totalWei);
    const weeks = await json(await fetch(`${app.base}/stats/revenue?creator=${CREATOR}&period=week`));
    assert.equal(weeks.body.points.length, 12);
    const months = await json(await fetch(`${app.base}/stats/revenue?creator=${CREATOR}&period=month`));
    assert.equal(months.body.points.length, 12);
    const cl = await json(await fetch(`${app.base}/stats/clients?creator=${CREATOR}&limit=3`));
    assert.equal(cl.body.clients.length, 3);
    assert.ok(BigInt(cl.body.clients[0].totalWei) >= BigInt(cl.body.clients[1].totalWei));
  });

  it("POST /sync en mock responde ok sin tocar la cadena", async () => {
    const r = await json(await post(`${app.base}/sync`, { txHash: hash(1) }));
    assert.deepEqual(r.body, { ok: true, mock: true, processed: 0, requests: [] });
  });

  it("CORS: refleja solo orígenes permitidos y responde preflight", async () => {
    const ok = await fetch(`${app.base}/health`, { headers: { Origin: "https://monpago-git-abc.vercel.app" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://monpago-git-abc.vercel.app");
    const no = await fetch(`${app.base}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(no.headers.get("access-control-allow-origin"), null);
    const pre = await fetch(`${app.base}/requests/meta`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:3000");
  });

  it("ruta desconocida: 404 con JSON", async () => {
    const r = await json(await fetch(`${app.base}/nope`));
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });
});

describe("API en modo live (con sync simulado)", () => {
  let app: Awaited<ReturnType<typeof start>>;
  const store = new MemoryStore();
  const t0 = 1_760_000_000;
  const createdEv: ChainEvent = {
    name: "RequestCreated", id: 1n, creator: CREATOR, amount: 1_500_000_000_000_000_000n,
    concept: "Logo", txHash: hash(11), blockNumber: 10n, logIndex: 0, timestamp: t0,
  };
  const paidEv: ChainEvent = {
    name: "PaymentReceived", id: 1n, creator: CREATOR, payer: PAYER, amount: 1_500_000_000_000_000_000n,
    txHash: hash(12), blockNumber: 12n, logIndex: 0, timestamp: t0 + 120,
  };
  const txs: Record<string, ChainEvent[]> = { [hash(11)]: [createdEv], [hash(12)]: [paidEv], [hash(13)]: [] };

  before(async () => {
    app = await start({
      store,
      mode: "live",
      syncTx: async (h) => {
        if (h === hash(99)) throw new HttpError(504, "La transacción aún no se confirma. Reintenta en unos segundos.");
        return txs[h] ?? [];
      },
    });
  });
  after(() => app.server.close());

  it("meta antes de indexar -> 404 con instrucciones", async () => {
    const r = await json(await post(`${app.base}/requests/meta`, { id: "1", creator: CREATOR, clientName: "X" }));
    assert.equal(r.status, 404);
    assert.match(r.body.error, /POST \/sync/);
  });

  it("sync de creación con metadatos incluidos", async () => {
    const r = await json(await post(`${app.base}/sync`, { txHash: hash(11), clientName: "Marta Rojas", category: "Diseño" }));
    assert.equal(r.status, 200);
    assert.equal(r.body.processed, 1);
    assert.equal(r.body.requests[0].status, "pending");
    assert.equal(r.body.requests[0].clientName, "Marta Rojas");
    assert.equal(r.body.requests[0].amountMon, "1.5");
    assert.equal((await fetch(`${app.base}/requests/1`)).status, 200);
  });

  it("meta: solo el creador puede editar (403) y el creador sí (200)", async () => {
    const bad = await json(await post(`${app.base}/requests/meta`, { id: "1", creator: OTHER, clientName: "Hack" }));
    assert.equal(bad.status, 403);
    const ok = await json(await post(`${app.base}/requests/meta`, { id: "1", creator: CREATOR.toUpperCase().replace("0X", "0x"), category: "Logo" }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.request.category, "Logo");
    assert.equal(ok.body.request.clientName, "Marta Rojas"); // no enviado => intacto
    assert.equal((await post(`${app.base}/requests/meta`, { id: "1", creator: CREATOR })).status, 400);
  });

  it("sync del pago: pasa a pagada y las métricas lo reflejan al instante", async () => {
    const r = await json(await post(`${app.base}/sync`, { txHash: hash(12) }));
    assert.equal(r.body.requests[0].status, "paid");
    assert.equal(r.body.requests[0].payer, PAYER);
    assert.ok(r.body.requests[0].paidTxUrl.endsWith(`/tx/${hash(12)}`));
    const s = await json(await fetch(`${app.base}/stats/summary?creator=${CREATOR}`));
    assert.equal(s.body.totalRevenueMon, "1.5");
    assert.equal(s.body.requestsPaid, 1);
    assert.equal(s.body.avgPaymentTimeSeconds, 120);
    // otro creador no ve estos datos
    const other = await json(await fetch(`${app.base}/stats/summary?creator=${OTHER}`));
    assert.equal(other.body.requestsCreated, 0);
  });

  it("sync de una tx sin eventos de MonPago -> 422; error del RPC se propaga con su código", async () => {
    assert.equal((await post(`${app.base}/sync`, { txHash: hash(13) })).status, 422);
    assert.equal((await post(`${app.base}/sync`, { txHash: hash(99) })).status, 504);
  });
});
