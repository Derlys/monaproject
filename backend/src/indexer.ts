import { applyEvents } from "./processor.js";
import type { ChainEvent } from "./processor.js";
import type { Store } from "./store.js";

/** Lectura de la cadena. La implementación real (viem) está en chain.ts. */
export interface ChainReader {
  getHead(): Promise<bigint>;
  /** Eventos del contrato en el rango [from, to] (ambos incluidos). */
  getEvents(from: bigint, to: bigint): Promise<ChainEvent[]>;
}

export interface IndexerOptions {
  deployBlock: bigint;
  /** Máximo de bloques por consulta getLogs (los RPC públicos limitan el rango). */
  chunkSize: bigint;
  pollIntervalMs: number;
  /** Bloques de margen respecto a la punta de la cadena. */
  confirmations: bigint;
  log?: (message: string) => void;
}

export interface IndexerStatus {
  running: boolean;
  lastIndexedBlock: string | null;
  headBlock: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  eventsProcessed: number;
}

export class Indexer {
  private active = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private wake: (() => void) | undefined;
  private readonly state: IndexerStatus = {
    running: false,
    lastIndexedBlock: null,
    headBlock: null,
    lastRunAt: null,
    lastError: null,
    eventsProcessed: 0,
  };

  constructor(
    private readonly store: Store,
    private readonly chain: ChainReader,
    private readonly options: IndexerOptions,
  ) {}

  status(): IndexerStatus {
    return { ...this.state, running: this.active };
  }

  /**
   * Una pasada: se pone al día desde `last_block + 1` (o desde el bloque de despliegue)
   * hasta la punta de la cadena, en trozos de `chunkSize`. Persiste `last_block` tras
   * cada trozo, así que un reinicio retoma donde quedó. Devuelve los eventos procesados.
   */
  async runOnce(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const last = await this.store.getLastBlock();
      let from = last !== null ? last + 1n : this.options.deployBlock;
      const head = (await this.chain.getHead()) - this.options.confirmations;
      this.state.headBlock = head.toString();

      let processed = 0;
      while (from <= head) {
        const to = from + this.options.chunkSize - 1n < head ? from + this.options.chunkSize - 1n : head;
        const events = await this.chain.getEvents(from, to);
        processed += await applyEvents(this.store, events);
        await this.store.setLastBlock(to);
        this.state.lastIndexedBlock = to.toString();
        if (events.length > 0) {
          this.options.log?.(`Bloques ${from}-${to}: ${events.length} evento(s)`);
        }
        from = to + 1n;
      }

      this.state.eventsProcessed += processed;
      this.state.lastRunAt = new Date().toISOString();
      this.state.lastError = null;
      return processed;
    } finally {
      this.busy = false;
    }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.loop();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
  }

  private async loop(): Promise<void> {
    let delay = this.options.pollIntervalMs;
    while (this.active) {
      try {
        await this.runOnce();
        delay = this.options.pollIntervalMs;
      } catch (err) {
        this.state.lastError = err instanceof Error ? err.message : String(err);
        this.options.log?.(`Error del indexador: ${this.state.lastError}`);
        delay = Math.min(delay * 2, 30_000); // backoff ante errores del RPC
      }
      if (!this.active) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve; // stop() lo usa para despertar el bucle de inmediato
        this.timer = setTimeout(resolve, delay);
      });
    }
  }
}
