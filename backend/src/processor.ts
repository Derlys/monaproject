import type { Store } from "./store.js";

/** Evento ya decodificado, independiente de viem (así la lógica se puede probar sin red). */
export interface RequestCreatedEvent {
  name: "RequestCreated";
  id: bigint;
  creator: string;
  amount: bigint;
  concept: string;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  /** Timestamp del bloque, en segundos. */
  timestamp: number;
}

export interface PaymentReceivedEvent {
  name: "PaymentReceived";
  id: bigint;
  creator: string;
  payer: string;
  amount: bigint;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  timestamp: number;
}

export type ChainEvent = RequestCreatedEvent | PaymentReceivedEvent;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** Orden canónico on-chain: bloque, luego índice de log. */
export function sortEvents(events: ChainEvent[]): ChainEvent[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
}

/**
 * Aplica un evento con upsert por id. Es idempotente y no depende del orden:
 * - RequestCreated nunca toca `status`, así que no puede "des-pagar" una solicitud.
 * - Solo PaymentReceived pone status = "paid": una solicitud únicamente figura como
 *   pagada si el evento existe on-chain.
 */
export async function applyEvent(store: Store, ev: ChainEvent): Promise<void> {
  const id = ev.id.toString();
  if (ev.name === "RequestCreated") {
    await store.upsertRequest(id, {
      creator: ev.creator.toLowerCase(),
      amountWei: ev.amount.toString(),
      concept: ev.concept,
      createdTx: ev.txHash.toLowerCase(),
      createdBlock: ev.blockNumber.toString(),
      createdAt: iso(ev.timestamp),
    });
  } else {
    await store.upsertRequest(id, {
      creator: ev.creator.toLowerCase(),
      payer: ev.payer.toLowerCase(),
      amountWei: ev.amount.toString(),
      status: "paid",
      paidTx: ev.txHash.toLowerCase(),
      paidBlock: ev.blockNumber.toString(),
      paidAt: iso(ev.timestamp),
    });
  }
}

export async function applyEvents(store: Store, events: ChainEvent[]): Promise<number> {
  for (const ev of sortEvents(events)) {
    await applyEvent(store, ev);
  }
  return events.length;
}
