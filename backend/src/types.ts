export type RequestStatus = "pending" | "paid";

/**
 * Una solicitud de pago. Casi todos los campos son nullables porque el indexador
 * hace upsert por id y los eventos pueden llegar en cualquier orden
 * (p. ej. PaymentReceived antes que RequestCreated).
 *
 * - Direcciones: siempre en minúsculas.
 * - amountWei: string decimal (los wei no caben en un number de JS).
 * - Fechas: ISO 8601 (UTC).
 */
export interface PaymentRequest {
  id: string;
  creator: string | null;
  payer: string | null;
  amountWei: string | null;
  concept: string | null;
  status: RequestStatus;
  clientName: string | null;
  category: string | null;
  createdTx: string | null;
  createdBlock: string | null;
  createdAt: string | null;
  paidTx: string | null;
  paidBlock: string | null;
  paidAt: string | null;
}

/** Cambios parciales: `undefined` = no tocar, `null` = poner en NULL. */
export type RequestPatch = {
  [K in keyof Omit<PaymentRequest, "id">]?: PaymentRequest[K];
};

export function emptyRequest(id: string): PaymentRequest {
  return {
    id,
    creator: null,
    payer: null,
    amountWei: null,
    concept: null,
    status: "pending",
    clientName: null,
    category: null,
    createdTx: null,
    createdBlock: null,
    createdAt: null,
    paidTx: null,
    paidBlock: null,
    paidAt: null,
  };
}
