import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { HttpError } from "./errors.js";
import { formatMon, isAddress, isRequestId, isTxHash } from "./format.js";
import { applyEvents } from "./processor.js";
import type { ChainEvent } from "./processor.js";
import { DEFAULT_TZ_OFFSET_MINUTES, defaultRange, estimateBuckets, revenueSeries, summarize, topClients } from "./stats.js";
import type { Period } from "./stats.js";
import type { Store } from "./store.js";
import type { PaymentRequest, RequestPatch, RequestStatus } from "./types.js";

export interface AppDeps {
  store: Store;
  mode: "mock" | "live";
  /** Datos públicos que el frontend puede consultar en GET /config. */
  publicConfig: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    contractAddress: string;
    deployBlock: string;
  };
  allowedOrigins: string[];
  /** Lee los eventos de MonPago de una transacción (solo modo live). */
  syncTx?: (txHash: string) => Promise<ChainEvent[]>;
  indexerStatus?: () => unknown;
  now?: () => number;
}

// ---- Utilidades -------------------------------------------------------------------------

const escapeRegExp = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function originAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === origin;
    const re = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$");
    return re.test(origin);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 100_000) throw new HttpError(413, "Cuerpo demasiado grande");
    chunks.push(buf);
  }
  if (size === 0) throw new HttpError(400, "Se esperaba un cuerpo JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "El cuerpo debe ser un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number, name: string): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} debe ser un entero`);
  return Math.min(max, Math.max(min, n));
}

function requireCreator(q: URLSearchParams): string {
  const creator = q.get("creator");
  if (!isAddress(creator)) throw new HttpError(400, "Falta el parámetro creator (dirección 0x válida)");
  return creator.toLowerCase();
}

/** Texto libre opcional: undefined = no enviado, null = borrar, string = valor limpio. */
function cleanText(value: unknown, max: number, name: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${name} debe ser texto`);
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (text.length > max) throw new HttpError(400, `${name} admite máximo ${max} caracteres`);
  return text === "" ? null : text;
}

function toApi(r: PaymentRequest, explorerUrl: string) {
  const txUrl = (hash: string | null) => (hash ? `${explorerUrl}/tx/${hash}` : null);
  return {
    id: r.id,
    creator: r.creator,
    payer: r.payer,
    amountWei: r.amountWei,
    amountMon: r.amountWei ? formatMon(BigInt(r.amountWei)) : null,
    concept: r.concept,
    status: r.status,
    clientName: r.clientName,
    category: r.category,
    createdAt: r.createdAt,
    createdTx: r.createdTx,
    createdTxUrl: txUrl(r.createdTx),
    createdBlock: r.createdBlock,
    paidAt: r.paidAt,
    paidTx: r.paidTx,
    paidTxUrl: txUrl(r.paidTx),
    paidBlock: r.paidBlock,
  };
}

// ---- Aplicación -------------------------------------------------------------------------

export function createApp(deps: AppDeps): Server {
  const now = deps.now ?? Date.now;
  const explorer = deps.publicConfig.explorerUrl.replace(/\/$/, "");
  const api = (r: PaymentRequest) => toApi(r, explorer);
  const startedAt = now();

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = url.searchParams;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/health") {
      send(res, 200, {
        ok: true,
        mode: deps.mode,
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        chainId: deps.publicConfig.chainId,
        contractAddress: deps.publicConfig.contractAddress,
        indexer: deps.indexerStatus?.() ?? null,
      });
      return;
    }

    if (method === "GET" && path === "/config") {
      send(res, 200, { mode: deps.mode, ...deps.publicConfig });
      return;
    }

    // --- Solicitudes ---
    if (method === "GET" && path === "/requests") {
      const creatorRaw = q.get("creator");
      if (creatorRaw !== null && !isAddress(creatorRaw)) throw new HttpError(400, "creator no es una dirección válida");
      const statusRaw = q.get("status");
      if (statusRaw && !["all", "pending", "paid"].includes(statusRaw)) {
        throw new HttpError(400, "status debe ser all, pending o paid");
      }
      const status = statusRaw && statusRaw !== "all" ? (statusRaw as RequestStatus) : undefined;
      const limit = clampInt(q.get("limit"), 1, 100, 20, "limit");
      const offset = clampInt(q.get("offset"), 0, 1_000_000_000, 0, "offset");
      const { items, total } = await deps.store.listRequests({
        creator: creatorRaw ? creatorRaw.toLowerCase() : undefined,
        status,
        limit,
        offset,
      });
      send(res, 200, { items: items.map(api), total, limit, offset });
      return;
    }

    if (method === "POST" && path === "/requests/meta") {
      const body = await readJson(req);
      if (!isRequestId(String(body.id ?? ""))) throw new HttpError(400, "id inválido");
      if (!isAddress(body.creator)) throw new HttpError(400, "creator debe ser una dirección 0x válida");
      const clientName = cleanText(body.clientName, 80, "clientName");
      const category = cleanText(body.category, 40, "category");
      if (clientName === undefined && category === undefined) {
        throw new HttpError(400, "Envía clientName y/o category");
      }
      const id = String(body.id);
      const row = await deps.store.getRequest(id);
      if (!row || row.amountWei === null) {
        throw new HttpError(
          404,
          "La solicitud aún no está indexada. Llama primero a POST /sync con el hash de la transacción.",
        );
      }
      if (row.creator !== body.creator.toLowerCase()) {
        throw new HttpError(403, "Solo el creador de la solicitud puede editar estos datos");
      }
      const patch: RequestPatch = {};
      if (clientName !== undefined) patch.clientName = clientName;
      if (category !== undefined) patch.category = category;
      await deps.store.upsertRequest(id, patch);
      const updated = await deps.store.getRequest(id);
      send(res, 200, { ok: true, request: updated ? api(updated) : null });
      return;
    }

    const byId = path.match(/^\/requests\/(\d{1,78})$/);
    if (method === "GET" && byId) {
      const row = await deps.store.getRequest(byId[1]!);
      if (!row || row.amountWei === null) {
        throw new HttpError(404, "Solicitud no encontrada o aún no indexada");
      }
      send(res, 200, api(row));
      return;
    }

    // --- Sincronización inmediata tras crear/pagar ---
    if (method === "POST" && path === "/sync") {
      const body = await readJson(req);
      if (!isTxHash(body.txHash)) throw new HttpError(400, "txHash debe ser un hash 0x de 32 bytes");
      const clientName = cleanText(body.clientName, 80, "clientName");
      const category = cleanText(body.category, 40, "category");

      if (!deps.syncTx) {
        send(res, 200, { ok: true, mock: true, processed: 0, requests: [] });
        return;
      }

      const events = await deps.syncTx(body.txHash.toLowerCase());
      if (events.length === 0) {
        throw new HttpError(422, "La transacción no contiene eventos de MonPago");
      }
      await applyEvents(deps.store, events);

      // Metadatos off-chain opcionales, aplicados a las solicitudes creadas en esta tx.
      if (clientName !== undefined || category !== undefined) {
        const patch: RequestPatch = {};
        if (clientName !== undefined) patch.clientName = clientName;
        if (category !== undefined) patch.category = category;
        for (const ev of events) {
          if (ev.name === "RequestCreated") await deps.store.upsertRequest(ev.id.toString(), patch);
        }
      }

      const ids = [...new Set(events.map((e) => e.id.toString()))];
      const requests: ReturnType<typeof api>[] = [];
      for (const id of ids) {
        const row = await deps.store.getRequest(id);
        if (row) requests.push(api(row));
      }
      send(res, 200, { ok: true, processed: events.length, requests });
      return;
    }

    // --- Estadísticas ---
    if (method === "GET" && path === "/stats/summary") {
      const creator = requireCreator(q);
      const rows = await deps.store.allByCreator(creator);
      send(res, 200, { creator, ...summarize(rows, now()) });
      return;
    }

    if (method === "GET" && path === "/stats/revenue") {
      const creator = requireCreator(q);
      const period = (q.get("period") ?? "day") as Period;
      if (!["day", "week", "month"].includes(period)) throw new HttpError(400, "period debe ser day, week o month");
      const tz = clampInt(q.get("tz"), -720, 840, DEFAULT_TZ_OFFSET_MINUTES, "tz");

      const range = defaultRange(period, now(), tz);
      const parseDate = (raw: string | null, fallback: number, name: string) => {
        if (!raw) return fallback;
        const ms = Date.parse(raw);
        if (Number.isNaN(ms)) throw new HttpError(400, `${name} no es una fecha válida`);
        return ms;
      };
      const fromMs = parseDate(q.get("from"), range.fromMs, "from");
      const toMs = parseDate(q.get("to"), range.toMs, "to");
      if (fromMs > toMs) throw new HttpError(400, "from debe ser anterior a to");
      if (estimateBuckets(period, fromMs, toMs) > 400) throw new HttpError(400, "Rango demasiado grande para ese period");

      const rows = await deps.store.allByCreator(creator);
      send(res, 200, { creator, ...revenueSeries(rows, { period, fromMs, toMs, tzOffsetMin: tz }) });
      return;
    }

    if (method === "GET" && path === "/stats/clients") {
      const creator = requireCreator(q);
      const limit = clampInt(q.get("limit"), 1, 50, 10, "limit");
      const rows = await deps.store.allByCreator(creator);
      send(res, 200, { creator, clients: topClients(rows, limit) });
      return;
    }

    throw new HttpError(404, "Ruta no encontrada");
  }

  return createServer((req, res) => {
    // CORS: solo se reflejan orígenes permitidos (FRONTEND_URL).
    const origin = req.headers.origin;
    if (origin && originAllowed(origin, deps.allowedOrigins)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    route(req, res).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
      } else {
        console.error("[error]", err);
        send(res, 500, { error: "Error interno del servidor" });
      }
    });
  });
}
