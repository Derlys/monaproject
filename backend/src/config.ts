type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  allowedOrigins: string[];
  useMock: boolean;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  deployBlock: bigint;
  logChunkSize: bigint;
  pollIntervalMs: number;
  confirmations: bigint;
  supabaseUrl?: string;
  supabaseKey?: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function int(env: Env, name: string, fallback: number, errors: string[], min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    errors.push(`${name} debe ser un entero >= ${min} (recibido "${raw}")`);
    return fallback;
  }
  return n;
}

/** Lee y valida las variables de entorno. Lanza un error único con todos los problemas. */
export function loadConfig(env: Env = process.env): Config {
  const errors: string[] = [];

  const useMock = (env.USE_MOCK ?? "true").toLowerCase() === "true";
  const contractAddress = (env.CONTRACT_ADDRESS ?? ZERO_ADDRESS).trim();
  const deployBlock = int(env, "DEPLOY_BLOCK", 0, errors);

  const cfg: Config = {
    port: int(env, "PORT", 4000, errors, 1),
    allowedOrigins: (env.FRONTEND_URL ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    useMock,
    chainId: int(env, "CHAIN_ID", 10143, errors, 1),
    rpcUrl: env.RPC_URL?.trim() || "https://testnet-rpc.monad.xyz",
    explorerUrl: (env.EXPLORER_URL?.trim() || "https://testnet.monadvision.com").replace(/\/$/, ""),
    contractAddress,
    deployBlock: BigInt(deployBlock),
    logChunkSize: BigInt(int(env, "LOG_CHUNK_SIZE", 100, errors, 1)),
    pollIntervalMs: int(env, "POLL_INTERVAL_MS", 2000, errors, 200),
    confirmations: BigInt(int(env, "CONFIRMATIONS", 1, errors)),
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  };

  if (!useMock) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress) || contractAddress.toLowerCase() === ZERO_ADDRESS) {
      errors.push("CONTRACT_ADDRESS debe ser la dirección del contrato desplegado");
    }
    if (deployBlock <= 0) {
      errors.push("DEPLOY_BLOCK debe ser el bloque de despliegue del contrato (> 0)");
    }
    if (!cfg.supabaseUrl) errors.push("Falta SUPABASE_URL");
    if (!cfg.supabaseKey) errors.push("Falta SUPABASE_SERVICE_ROLE_KEY");
  }

  if (errors.length > 0) {
    throw new Error(`Configuración inválida:\n - ${errors.join("\n - ")}`);
  }
  return cfg;
}
