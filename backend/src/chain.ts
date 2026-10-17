import { createPublicClient, defineChain, http, isAddressEqual, parseEventLogs } from "viem";
import type { Hash } from "viem";
import { monPagoEvents } from "./abi.js";
import type { Config } from "./config.js";
import { HttpError } from "./errors.js";
import type { ChainReader } from "./indexer.js";
import type { ChainEvent } from "./processor.js";

/** Forma mínima de un log ya decodificado (evita acoplar el resto del código a los tipos de viem). */
interface DecodedLog {
  eventName: string;
  args: unknown;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
}

export function createChain(cfg: Config) {
  const chain = defineChain({
    id: cfg.chainId,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: { default: { name: "MonadVision", url: cfg.explorerUrl } },
  });

  const client = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { retryCount: 3, retryDelay: 500, timeout: 15_000 }),
  });

  const contract = cfg.contractAddress as `0x${string}`;
  const timestamps = new Map<bigint, number>();

  async function blockTimestamp(blockNumber: bigint): Promise<number> {
    const cached = timestamps.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const seconds = Number(block.timestamp);
    if (timestamps.size > 500) timestamps.clear();
    timestamps.set(blockNumber, seconds);
    return seconds;
  }

  async function toChainEvents(logs: DecodedLog[]): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    for (const log of logs) {
      // Los logs pendientes no traen bloque/hash/índice: se ignoran.
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
      const base = {
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        timestamp: await blockTimestamp(log.blockNumber),
      };
      if (log.eventName === "RequestCreated") {
        const a = log.args as { id: bigint; creator: string; amount: bigint; concept: string };
        out.push({ name: "RequestCreated", id: a.id, creator: a.creator, amount: a.amount, concept: a.concept, ...base });
      } else if (log.eventName === "PaymentReceived") {
        const a = log.args as { id: bigint; creator: string; payer: string; amount: bigint };
        out.push({ name: "PaymentReceived", id: a.id, creator: a.creator, payer: a.payer, amount: a.amount, ...base });
      }
    }
    return out;
  }

  const reader: ChainReader = {
    getHead: () => client.getBlockNumber(),
    async getEvents(from, to) {
      const logs = await client.getLogs({
        address: contract,
        events: monPagoEvents,
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      return toChainEvents(logs as unknown as DecodedLog[]);
    },
  };

  /** Eventos de MonPago dentro de una transacción (para POST /sync). */
  async function getEventsFromTx(hash: string): Promise<ChainEvent[]> {
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash: hash as Hash, timeout: 20_000 });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name.includes("Timeout") || name.includes("NotFound")) {
        throw new HttpError(504, "La transacción aún no se confirma. Reintenta en unos segundos.");
      }
      throw new HttpError(502, "No se pudo leer la transacción desde el RPC de Monad.");
    }
    if (receipt.status !== "success") {
      throw new HttpError(422, "La transacción fue revertida; no hay nada que sincronizar.");
    }
    const mine = receipt.logs.filter((l) => isAddressEqual(l.address, contract));
    const decoded = parseEventLogs({ abi: monPagoEvents, logs: mine, strict: true });
    return toChainEvents(decoded as unknown as DecodedLog[]);
  }

  /** Comprobaciones de arranque: la red es la esperada y el contrato existe. */
  async function verify(log: (m: string) => void): Promise<void> {
    const id = await client.getChainId();
    if (id !== cfg.chainId) {
      throw new Error(`El RPC responde chainId ${id} pero CHAIN_ID es ${cfg.chainId}`);
    }
    const code = await client.getCode({ address: contract });
    if (!code || code === "0x") {
      throw new Error(`No hay contrato en ${contract} (chain ${id}). Revisa CONTRACT_ADDRESS.`);
    }
    log(`Conectado a chain ${id}; contrato ${contract} verificado`);
  }

  return { reader, getEventsFromTx, verify };
}
