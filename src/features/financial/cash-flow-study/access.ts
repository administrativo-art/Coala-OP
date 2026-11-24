import { AppError } from "@/lib/observability/app-error";

/**
 * O estudo junta saldo bancário, carteira Stone, depósitos e despesas de todas as unidades:
 * mesma regra das telas de recebíveis Stone, somente o administrador padrão.
 */
export function authorizeCashFlowStudyActor(actor: { isDefaultAdmin: boolean }) {
  if (!actor.isDefaultAdmin) throw new AppError({ code: "CASH_FLOW_STUDY_FORBIDDEN", kind: "AUTHORIZATION" });
}
