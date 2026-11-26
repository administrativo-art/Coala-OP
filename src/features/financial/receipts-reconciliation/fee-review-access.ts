import { AppError } from "@/lib/observability/app-error";

/** Regras de acesso da rota de Taxas, isoladas para teste (a rota só as compõe no enforcer). */
export function authorizeStoneFeeActor(actor: { isDefaultAdmin: boolean }) {
  // Mesma regra das demais telas de recebíveis Stone: somente o administrador padrão.
  if (!actor.isDefaultAdmin) throw new AppError({ code: "STONE_FEES_FORBIDDEN", kind: "AUTHORIZATION" });
}

/** O vínculo oficial (unidade × StoneCode) precisa ser do workspace da sessão; o cliente não escolhe workspace. */
export function assertStoneFeeScope(actor: { workspace_id: string }, input: { kioskId: string; stoneCode: string },
  mapping: { workspaceId: string; kioskId: string; stoneCodes: string[] }) {
  if (mapping.workspaceId !== actor.workspace_id || mapping.kioskId !== input.kioskId || !mapping.stoneCodes.includes(input.stoneCode)) {
    throw new AppError({ code: "STONE_FEES_SCOPE", kind: "AUTHORIZATION" });
  }
}
