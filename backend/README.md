# MonPago Colombia · Backend

API + indexador de eventos para MonPago (Monad Testnet). Node + TypeScript, `viem` para leer la
cadena y Supabase (Postgres) para guardar. Sin framework web: solo `node:http`.

**Regla de oro:** una solicitud solo figura como `paid` si el evento `PaymentReceived` existe
on-chain. Nada del frontend puede marcarla como pagada.

## Arranque rápido (modo mock, sin contrato ni Supabase)

```bash
cd backend
npm install
cp .env.example .env      # USE_MOCK=true por defecto
npm run dev               # http://localhost:4000
```

En modo mock la API devuelve 48 solicitudes falsas (deterministas) y **ignora el filtro
`creator`**, así que cualquier wallet conectada ve datos. Sirve para que el frontend avance
mientras el contrato no está desplegado.

## Pasar a modo real

1. **Supabase**: crea el proyecto y ejecuta `supabase/schema.sql` en *SQL Editor → Run*.
   Copia `Project URL` y la `service_role key` (Settings → API). La service role key va
   **solo** en variables de entorno del backend, nunca en el frontend ni en el repo.
2. **Contrato**: con el contrato desplegado en Monad Testnet, anota su dirección y el
   **bloque de despliegue** (visible en el explorer).
3. Edita `.env`:

   ```env
   USE_MOCK=false
   CONTRACT_ADDRESS=0x...        # dirección del contrato
   DEPLOY_BLOCK=12345678         # bloque de despliegue (obligatorio, > 0)
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   FRONTEND_URL=http://localhost:3000,https://tu-app.vercel.app
   ```

4. `npm run dev`. Al arrancar verifica que el RPC es chain `10143` y que hay código en la
   dirección del contrato; si no, aborta con un mensaje claro.

### Contrato esperado (importante)

El backend decodifica estos eventos (`src/abi.ts`). Deben coincidir **exactamente** con los de
`MonPago.sol`, incluyendo qué parámetros son `indexed`:

```solidity
event RequestCreated(uint256 indexed id, address indexed creator, uint256 amount, string concept);
event PaymentReceived(uint256 indexed id, address indexed creator, address indexed payer, uint256 amount);
```

Si el contrato final difiere, ajusta `src/abi.ts` y el mapeo en `src/chain.ts`.

## Endpoints

Todas las respuestas son JSON. Errores: `{ "error": "mensaje" }` con el código HTTP adecuado.
Los montos van como string en wei (`amountWei`) y en MON legible (`amountMon`).
`creator` siempre es una dirección `0x…` (no distingue mayúsculas).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado, modo (`mock`/`live`) y estado del indexador |
| GET | `/config` | `chainId`, `rpcUrl`, `explorerUrl`, `contractAddress`, `deployBlock` |
| GET | `/requests?creator=&status=&limit=&offset=` | Lista (más recientes primero). `status`: `all`/`pending`/`paid`. `limit` 1–100 (def. 20) |
| GET | `/requests/:id` | Una solicitud (para `/pay/[id]`). 404 si no existe o aún no está indexada |
| POST | `/requests/meta` | Guarda `clientName` y/o `category`. Body: `{ id, creator, clientName?, category? }` |
| POST | `/sync` | Sincronización inmediata. Body: `{ txHash, clientName?, category? }` |
| GET | `/stats/summary?creator=` | Ingresos totales / 7d / 30d, creadas, pagadas, pendientes, conversión, ticket promedio, tiempo promedio de pago |
| GET | `/stats/revenue?creator=&period=&from=&to=&tz=` | Serie para la gráfica. `period`: `day` (30 días por defecto), `week` (12), `month` (12). Rellena periodos vacíos con 0. `tz` en minutos (def. `-300`, Colombia) |
| GET | `/stats/clients?creator=&limit=` | Mejores clientes por total pagado (def. 10, máx. 50) |

Cada solicitud incluye `createdTxUrl` y `paidTxUrl` listos para enlazar al explorer.

### Flujo recomendado para el frontend

1. **Crear**: la wallet envía `createPaymentRequest` → esperar el recibo → `POST /sync` con
   `{ txHash, clientName, category }`. Un solo llamado indexa la solicitud y guarda los datos
   off-chain (evita problemas de orden con `/requests/meta`).
2. **Pagar**: la wallet envía `payRequest(id)` → esperar el recibo → `POST /sync` con `{ txHash }`.
   El dashboard del creador se actualiza al instante, sin esperar al indexador.
3. `POST /requests/meta` queda para editar nombre/categoría después; devuelve 404 si la
   solicitud aún no está indexada (llama antes a `/sync`) y 403 si `creator` no es el dueño.

Códigos de `/sync`: `422` la tx no tiene eventos de MonPago o fue revertida; `504` la tx aún no
se confirma (reintentar); `502` fallo del RPC.

## Cómo funciona el indexador

- Lee `last_block` de `indexer_state`; empieza en `last_block + 1` (o en `DEPLOY_BLOCK`).
- Se pone al día con `getLogs` en trozos de `LOG_CHUNK_SIZE` bloques (el RPC público de Monad
  limita el rango) y luego sondea cada `POLL_INTERVAL_MS`.
- Guarda `last_block` solo después de procesar cada trozo: un reinicio o un error del RPC
  repite el trozo, nunca se salta eventos. Ante errores usa backoff hasta 30 s.
- Todo es **upsert por id**, idempotente y sin depender del orden de los eventos.
- Usa sondeo de `getLogs` en lugar de `watchContractEvent` porque necesita persistir el
  bloque y los filtros de los RPC públicos suelen expirar.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga |
| `npm test` | 28 pruebas (estadísticas, indexador, API completa) |
| `npm run typecheck` | Verificación de tipos |
| `npm run build && npm start` | Compila y arranca (producción) |

## Despliegue (Render o Railway)

El indexador necesita un proceso continuo, así que **no** sirve Vercel serverless.

- **Render**: `render.yaml` (Blueprint) incluido. Build `npm install && npm run build`,
  start `npm start`, health check `/health`. Carga las variables marcadas `sync: false`.
- **Railway**: mismo build/start; define las variables del `.env.example`.
- Plan gratuito de Render duerme el servicio tras inactividad y el indexador se detiene;
  al despertar retoma desde `last_block`, pero para la demo conviene abrir `/health` antes.
- Define `FRONTEND_URL` con el dominio de Vercel (acepta varios separados por coma y
  comodines, p. ej. `https://*.vercel.app` para previews).

## Limitaciones conocidas

- **Sin autenticación**: `/requests/meta` y el metadato de `/sync` confían en que `creator`
  sea el dueño real (es público on-chain). Cualquiera podría editar nombre/categoría de una
  solicitud ajena. Es un riesgo menor (no afecta pagos); para cerrarlo haría falta una firma
  de wallet (`signMessage`) verificada en el backend.
- Las métricas se calculan en memoria sobre las solicitudes del creador (suficiente para el
  volumen de un hackatón).
