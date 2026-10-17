import { emptyRequest } from "./types.js";
import type { PaymentRequest } from "./types.js";

/** Creador ficticio de los datos de ejemplo (en modo mock se ignora el filtro por creador). */
export const MOCK_CREATOR = "0x1111111111111111111111111111111111111111";

const CLIENTS = [
  "Studio Andina",
  "Café del Valle",
  "Logística Caribe",
  "Marta Rojas",
  "Tienda Orgánica Bogotá",
  "Agencia Pacífico",
  "Juan Pérez",
  "Ecotur Santa Marta",
];

const WORK: Record<string, string[]> = {
  Diseño: ["Logo y manual de marca", "Rediseño de empaque", "Piezas para redes"],
  Desarrollo: ["Landing page", "Integración de API", "Mantenimiento mensual"],
  Consultoría: ["Asesoría de procesos", "Diagnóstico digital"],
  Marketing: ["Campaña de pauta", "Estrategia de contenido"],
  Traducción: ["Traducción ES-EN de catálogo", "Subtítulos de video"],
  Fotografía: ["Sesión de producto", "Cobertura de evento"],
};

/** PRNG determinista (mulberry32) para que los datos falsos sean siempre los mismos. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (rand: () => number, bytes: number) =>
  "0x" +
  Array.from({ length: bytes }, () =>
    Math.floor(rand() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");

export function buildSeed(nowMs: number, count = 48): PaymentRequest[] {
  const rand = prng(20261017);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
  const categories = Object.keys(WORK);
  const amountsMon = [0.5, 1, 1.5, 2, 3, 5, 8, 12];

  const createdTimes = Array.from({ length: count }, () => nowMs - rand() * 60 * 86_400_000).sort(
    (a, b) => a - b,
  );

  return createdTimes.map((createdMs, i) => {
    const id = String(i + 1);
    const category = pick(categories);
    const amountWei = BigInt(Math.round(pick(amountsMon) * 1000)) * 10n ** 15n;
    const row = emptyRequest(id);
    row.creator = MOCK_CREATOR;
    row.amountWei = amountWei.toString();
    row.concept = pick(WORK[category]!);
    row.clientName = pick(CLIENTS);
    row.category = category;
    row.createdTx = hex(rand, 32);
    row.createdBlock = String(1_000_000 + i * 1_500);
    row.createdAt = new Date(createdMs).toISOString();

    const paidMs = createdMs + (5 * 60_000 + rand() * 3 * 86_400_000);
    if (rand() < 0.65 && paidMs <= nowMs) {
      row.status = "paid";
      row.payer = hex(rand, 20);
      row.paidTx = hex(rand, 32);
      row.paidBlock = String(1_000_000 + i * 1_500 + 40);
      row.paidAt = new Date(paidMs).toISOString();
    }
    return row;
  });
}
