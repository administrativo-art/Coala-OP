import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { recognitionMapping } from "./recognition-mapping.server";
import { feeRequestSchema, type FeeRequest } from "./contracts";
import { assertFeeAdmin, type FeeContext } from "./source.server";
import { feeHash } from "./evidence";
import { feeRecognitionPolicySchema } from "./recognition-contracts";
export const policyActionSchema = z.object({ request: feeRequestSchema, policy: feeRecognitionPolicySchema, expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500) }).strict();
export async function saveRecognitionPolicy(raw: unknown, context: FeeContext) {
  assertFeeAdmin(context); const input = policyActionSchema.parse(raw);
  return db.runTransaction(async tx => {
    const { document: doc } = await recognitionMapping(input.request, context, tx); const ref = doc.ref;
    const previous = feeRecognitionPolicySchema.safeParse(doc.get("feeRecognitionPolicy")); const current = previous.success ? previous.data : null;
    if ((current?.version ?? 0) !== input.expectedVersion || input.policy.version !== input.expectedVersion + 1) throw new AppError({ code: "FEE_POLICY_REVISION", kind: "CONFLICT", safeMessage: "Configuração mudou. Recarregue antes de confirmar." });
    const accounts = await Promise.all([input.policy.variableAccountId, input.policy.financialAccountId].map(id => tx.get(db.collection("accounts").doc(id))));
    const children = await Promise.all([input.policy.variableAccountId, input.policy.financialAccountId].map(id => tx.get(db.collection("accounts").where("parentId", "==", id).limit(1))));
    accounts.forEach((account, index) => { if (!account.exists || (account.get("workspaceId") ?? WORKSPACE_ID) !== context.workspace_id || account.get("active") === false || account.get("isGroup") === true || account.get("is_dre_account") === false || !children[index].empty || account.get("dre_position") !== (index === 0 ? "custos_variaveis" : "despesas_financeiras")) throw new AppError({ code: "FEE_POLICY_ACCOUNT", kind: "VALIDATION", safeMessage: "Selecione contas-folha ativas: tarifas em custos variáveis e antecipação em despesas financeiras. Não houve recategorização automática." }); });
    const at = new Date().toISOString(); const policy = { ...input.policy, contracts: input.policy.contracts.map(contract => {
      const old = current?.contracts.find(c => c.id === contract.id && c.version === contract.version);
      if (old && feeHash(old) !== feeHash(contract)) throw new AppError({ code: "FEE_CONTRACT_IMMUTABLE", kind: "CONFLICT", safeMessage: "Contrato publicado é imutável; crie nova revisão com vigência própria." });
      return old ?? { ...contract, approvedAt: at };
    }) };
    tx.update(ref, { feeRecognitionPolicy: policy });
    tx.create(ref.collection("events").doc(randomUUID()), { type: "fee_policy_updated", actorId: context.decoded.uid, actorNamespace: "main.users", at, reason: input.reason, previous: current, next: policy });
    return { policy };
  });
}
export async function recognitionConfiguration(request: FeeRequest, context: FeeContext) {
  assertFeeAdmin(context);
  const { document: doc } = await recognitionMapping(request, context);
  const policy = feeRecognitionPolicySchema.safeParse(doc.get("feeRecognitionPolicy"));
  const accounts = await db.collection("accounts").where("dre_position", "in", ["custos_variaveis", "despesas_financeiras"]).limit(101).get();
  if (accounts.size > 100) throw new AppError({ code: "FEE_POLICY_LIMIT", kind: "CONFLICT" });
  return { policy: policy.success ? policy.data : null, accounts: accounts.docs.filter(d => (d.get("workspaceId") ?? WORKSPACE_ID) === context.workspace_id && d.get("active") !== false && d.get("isGroup") !== true && d.get("is_dre_account") !== false).map(d => ({ id: d.id, name: String(d.get("name") || d.id), position: d.get("dre_position") })) };
}
