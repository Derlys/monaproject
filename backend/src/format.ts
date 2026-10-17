const WEI_PER_MON = 10n ** 18n;

/** Convierte wei a MON como string legible (hasta 6 decimales, truncado, sin ceros finales). */
export function formatMon(wei: bigint, maxDecimals = 6): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI_PER_MON;
  const frac = (abs % WEI_PER_MON)
    .toString()
    .padStart(18, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${out}` : out;
}

export function parseWei(value: string | null | undefined): bigint {
  return value ? BigInt(value) : 0n;
}

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,78}$/.test(value);
}

export function compareBigIntDesc(a: bigint, b: bigint): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
