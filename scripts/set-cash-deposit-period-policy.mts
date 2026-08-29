/**
 * Configura a política de depósito de uma competência.
 * Seguro por padrão: sem --execute, apenas apresenta o plano da alteração.
 *
 * Exemplo:
 *   npm run cash-deposit:period-policy -- \
 *     --workspace coala --period 2026-08 --policy dre_only \
 *     --reason "Competência histórica usada somente na DRE" \
 *     --actor-id operador --actor-name "Operador do rollout"
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

import {
  cashDepositPeriodPolicyCommandSchema,
  cashDepositPeriodPolicyDocumentId,
  cashDepositPeriodPolicySchema,
  planCashDepositPeriodPolicyChange,
} from "../src/features/financial/cash-closures/deposit-policy-command";

config({ path: ".env.local" });

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Informe um valor para ${name}.`);
  return value;
}

const period = option("--period") ?? "";
const periodMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
if (!periodMatch) throw new Error("Informe --period no formato AAAA-MM.");

const command = cashDepositPeriodPolicyCommandSchema.parse({
  workspaceId: option("--workspace"),
  year: Number(periodMatch[1]),
  month: Number(periodMatch[2]),
  policy: option("--policy"),
  reason: option("--reason"),
  actorId: option("--actor-id"),
  actorName: option("--actor-name"),
});
const execute = process.argv.includes("--execute");
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");
const id = cashDepositPeriodPolicyDocumentId(command.workspaceId, command.year, command.month);
const policyRef = financialDbAdmin.collection("cashDepositPeriodPolicies").doc(id);
const initialSnapshot = await policyRef.get();
const initial = initialSnapshot.exists
  ? cashDepositPeriodPolicySchema.parse({ id: initialSnapshot.id, ...initialSnapshot.data() })
  : null;
const preflight = planCashDepositPeriodPolicyChange({
  command,
  existing: initial,
  now: new Date().toISOString(),
});

console.log(JSON.stringify({
  mode: execute ? "EXECUTE_REQUESTED" : "DRY_RUN",
  id,
  action: preflight.action,
  previous: preflight.previous,
  next: preflight.next,
}, null, 2));

if (execute && preflight.action !== "unchanged") {
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(policyRef);
    const existing = snapshot.exists
      ? cashDepositPeriodPolicySchema.parse({ id: snapshot.id, ...snapshot.data() })
      : null;
    const plan = planCashDepositPeriodPolicyChange({
      command,
      existing,
      now: new Date().toISOString(),
    });
    if (plan.action === "unchanged") return plan;
    transaction.set(policyRef, plan.next);
    const auditId = randomUUID();
    transaction.create(financialDbAdmin.collection("cashDepositPeriodPolicyAuditLogs").doc(auditId), {
      id: auditId,
      workspaceId: command.workspaceId,
      policyId: id,
      action: plan.action,
      previousPolicy: plan.previous?.policy ?? null,
      nextPolicy: plan.next.policy,
      previousReason: plan.previous?.reason ?? null,
      nextReason: plan.next.reason,
      actorId: command.actorId,
      actorName: command.actorName,
      createdAt: plan.next.updatedAt,
    });
    return plan;
  });
  console.log(JSON.stringify({ mode: "EXECUTED", id, action: result.action }, null, 2));
}
