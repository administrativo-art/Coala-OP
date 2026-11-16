import "server-only";

import { parseInterBalanceCents } from "./balance";
import { createInterClient } from "./client.server";
import { safeInterApiError } from "./error";

/** Saldo disponível da conta Inter, em centavos. Usa o mesmo escopo do extrato (`extrato.read`). */
export async function getInterAvailableBalanceCents(): Promise<number> {
  try {
    const client = await createInterClient("extrato.read", { basePath: "/banking/v2" });
    const response = await client.get<{ disponivel?: unknown }>("/saldo");
    return parseInterBalanceCents(response.data);
  } catch (error) {
    throw safeInterApiError(error, "api-request");
  }
}
