import { compareBigIntDesc, formatMon, parseWei } from "./format.js";
import type { PaymentRequest } from "./types.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_BUCKETS = 400;

/** Colombia no tiene horario de verano: UTC-5 fijo. */
export const DEFAULT_TZ_OFFSET_MINUTES = -300;

export type Period = "day" | "week" | "month";

const ts = (value: string | null): number => (value ? Date.parse(value) : NaN);

export function summarize(rows: PaymentRequest[], nowMs: number) {
  let total = 0n;
  let rev7d = 0n;
  let rev30d = 0n;
  let pendingAmount = 0n;
  let paid = 0;
  let pending = 0;
  let payTimeSumSeconds = 0;
  let payTimeCount = 0;

  for (const r of rows) {
    const amount = parseWei(r.amountWei);
    if (r.status === "paid") {
      paid++;
      total += amount;
      const paidAt = ts(r.paidAt);
      if (!Number.isNaN(paidAt)) {
        const age = nowMs - paidAt;
        if (age <= 7 * DAY_MS) rev7d += amount;
        if (age <= 30 * DAY_MS) rev30d += amount;
        const createdAt = ts(r.createdAt);
        if (!Number.isNaN(createdAt) && paidAt >= createdAt) {
          payTimeSumSeconds += (paidAt - createdAt) / 1000;
          payTimeCount++;
        }
      }
    } else {
      pending++;
      pendingAmount += amount;
    }
  }

  const created = rows.length;
  const avgTicket = paid > 0 ? total / BigInt(paid) : 0n;

  return {
    totalRevenueWei: total.toString(),
    totalRevenueMon: formatMon(total),
    revenueLast7dWei: rev7d.toString(),
    revenueLast7dMon: formatMon(rev7d),
    revenueLast30dWei: rev30d.toString(),
    revenueLast30dMon: formatMon(rev30d),
    pendingAmountWei: pendingAmount.toString(),
    pendingAmountMon: formatMon(pendingAmount),
    requestsCreated: created,
    requestsPaid: paid,
    requestsPending: pending,
    /** Fracción 0..1 (pagadas / creadas). */
    conversionRate: created > 0 ? Math.round((paid / created) * 10_000) / 10_000 : 0,
    avgTicketWei: avgTicket.toString(),
    avgTicketMon: formatMon(avgTicket),
    /** Promedio de segundos entre crear y pagar; null si aún no hay pagos. */
    avgPaymentTimeSeconds: payTimeCount > 0 ? Math.round(payTimeSumSeconds / payTimeCount) : null,
  };
}

// ---- Serie de ingresos en el tiempo ----------------------------------------------------

/**
 * Inicio del bucket que contiene `ms`, expresado en "espacio desplazado": un instante UTC
 * cuyos campos UTC equivalen a la hora local (con tzOffset aplicado).
 */
function bucketStart(ms: number, period: Period, tzOffsetMin: number): number {
  const d = new Date(ms + tzOffsetMin * MINUTE_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (period === "month") return Date.UTC(y, m, 1);
  if (period === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    return Date.UTC(y, m, day - dow);
  }
  return Date.UTC(y, m, day);
}

function nextBucket(bucket: number, period: Period): number {
  if (period === "month") {
    const d = new Date(bucket);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return bucket + (period === "week" ? 7 * DAY_MS : DAY_MS);
}

const label = (bucket: number) => new Date(bucket).toISOString().slice(0, 10);

/** Rango por defecto: 30 días, 12 semanas o 12 meses terminando en `nowMs` (instantes reales). */
export function defaultRange(period: Period, nowMs: number, tzOffsetMin: number) {
  const current = bucketStart(nowMs, period, tzOffsetMin);
  let first: number;
  if (period === "day") first = current - 29 * DAY_MS;
  else if (period === "week") first = current - 11 * 7 * DAY_MS;
  else {
    const d = new Date(current);
    first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1);
  }
  return { fromMs: first - tzOffsetMin * MINUTE_MS, toMs: nowMs };
}

export function estimateBuckets(period: Period, fromMs: number, toMs: number): number {
  const span = Math.max(0, toMs - fromMs) / DAY_MS;
  return Math.ceil(period === "day" ? span + 1 : period === "week" ? span / 7 + 1 : span / 28 + 1);
}

export function revenueSeries(
  rows: PaymentRequest[],
  opts: { period: Period; fromMs: number; toMs: number; tzOffsetMin?: number },
) {
  const tz = opts.tzOffsetMin ?? DEFAULT_TZ_OFFSET_MINUTES;
  const firstBucket = bucketStart(opts.fromMs, opts.period, tz);
  const lastBucket = bucketStart(opts.toMs, opts.period, tz);

  const acc = new Map<number, { wei: bigint; payments: number }>();
  for (let b = firstBucket, n = 0; b <= lastBucket && n < MAX_BUCKETS; b = nextBucket(b, opts.period), n++) {
    acc.set(b, { wei: 0n, payments: 0 });
  }

  let total = 0n;
  for (const r of rows) {
    if (r.status !== "paid") continue;
    const paidAt = ts(r.paidAt);
    if (Number.isNaN(paidAt)) continue;
    const slot = acc.get(bucketStart(paidAt, opts.period, tz));
    if (!slot) continue; // fuera del rango pedido
    const amount = parseWei(r.amountWei);
    slot.wei += amount;
    slot.payments += 1;
    total += amount;
  }

  return {
    period: opts.period,
    tzOffsetMinutes: tz,
    from: new Date(opts.fromMs).toISOString(),
    to: new Date(opts.toMs).toISOString(),
    totalWei: total.toString(),
    totalMon: formatMon(total),
    points: [...acc.entries()].map(([bucket, v]) => ({
      bucket: label(bucket),
      revenueWei: v.wei.toString(),
      revenueMon: formatMon(v.wei),
      payments: v.payments,
    })),
  };
}

// ---- Mejores clientes ------------------------------------------------------------------

export function topClients(rows: PaymentRequest[], limit: number) {
  const byClient = new Map<
    string,
    { client: string; total: bigint; payments: number; lastPaymentAt: number }
  >();

  for (const r of rows) {
    if (r.status !== "paid") continue;
    const name = r.clientName?.trim() || r.payer || "Sin nombre";
    const key = name.toLowerCase();
    const entry = byClient.get(key) ?? { client: name, total: 0n, payments: 0, lastPaymentAt: 0 };
    entry.total += parseWei(r.amountWei);
    entry.payments += 1;
    const paidAt = ts(r.paidAt);
    if (!Number.isNaN(paidAt) && paidAt > entry.lastPaymentAt) entry.lastPaymentAt = paidAt;
    byClient.set(key, entry);
  }

  return [...byClient.values()]
    .sort((a, b) => compareBigIntDesc(a.total, b.total) || b.payments - a.payments)
    .slice(0, limit)
    .map((c) => ({
      client: c.client,
      totalWei: c.total.toString(),
      totalMon: formatMon(c.total),
      payments: c.payments,
      lastPaymentAt: c.lastPaymentAt ? new Date(c.lastPaymentAt).toISOString() : null,
    }));
}
