import { parseAbi } from "viem";

/**
 * Eventos de MonPago.sol que lee el backend.
 *
 * IMPORTANTE: deben coincidir EXACTAMENTE (nombre, tipos y qué parámetros son `indexed`)
 * con los del contrato desplegado; si no, los logs no se decodifican. Si el contrato final
 * difiere, ajusta solo estas dos líneas (y los campos usados en chain.ts).
 */
export const monPagoEvents = parseAbi([
  "event RequestCreated(uint256 indexed id, address indexed creator, uint256 amount, string concept)",
  "event PaymentReceived(uint256 indexed id, address indexed creator, address indexed payer, uint256 amount)",
]);
