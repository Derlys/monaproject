import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";
import type { ChainEvent } from "./processor.js";
import { buildSeed } from "./seed.js";
import { createApp } from "./server.js";
import { MemoryStore } from "./store.js";
import type { Store } from "./store.js";

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const cfg = loadConfig();

  let store: Store;
  let syncTx: ((hash: string) => Promise<ChainEvent[]>) | undefined;
  let indexer: Indexer | undefined;

  if (cfg.useMock) {
    // Modo mock: datos falsos en memoria para destrabar al frontend. No toca la cadena.
    const memory = new MemoryStore({ anyCreator: true });
    memory.seed(buildSeed(Date.now()));
    store = memory;
    log("Modo MOCK: datos de ejemplo en memoria (sin Supabase ni blockchain)");
  } else {
    // Importaciones dinámicas: el modo mock no necesita viem ni supabase-js.
    const { SupabaseStore } = await import("./supabaseStore.js");
    const { createChain } = await import("./chain.js");

    store = new SupabaseStore(cfg.supabaseUrl!, cfg.supabaseKey!);
    const chain = createChain(cfg);
    await chain.verify(log);

    syncTx = chain.getEventsFromTx;
    indexer = new Indexer(store, chain.reader, {
      deployBlock: cfg.deployBlock,
      chunkSize: cfg.logChunkSize,
      pollIntervalMs: cfg.pollIntervalMs,
      confirmations: cfg.confirmations,
      log,
    });
    indexer.start();
    log(`Indexador iniciado desde el bloque ${cfg.deployBlock} (se retoma de indexer_state si existe)`);
  }

  const server = createApp({
    store,
    mode: cfg.useMock ? "mock" : "live",
    publicConfig: {
      chainId: cfg.chainId,
      rpcUrl: cfg.rpcUrl,
      explorerUrl: cfg.explorerUrl,
      contractAddress: cfg.contractAddress,
      deployBlock: cfg.deployBlock.toString(),
    },
    allowedOrigins: cfg.allowedOrigins,
    syncTx,
    indexerStatus: indexer ? () => indexer!.status() : undefined,
  });

  server.listen(cfg.port, () => {
    log(`API escuchando en http://localhost:${cfg.port}  (CORS: ${cfg.allowedOrigins.join(", ")})`);
  });

  const shutdown = (signal: string) => {
    log(`${signal} recibido, cerrando...`);
    indexer?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
