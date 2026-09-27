import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { canAccessUnit, resolveUnitAccess } from "@/lib/unit-access";
import { BudgetDomainError } from "./errors";

export async function listBudgetComparisonCenters(actor: ServerUserContext) {
  const scope = resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin });
  if (!scope.allUnits && !scope.unitIds.length) return { centers: [], allUnits: false };
  if (!scope.allUnits && scope.unitIds.length > 30) throw new BudgetDomainError("A consulta suporta até 30 unidades por perfil.");
  // Historical comparisons include inactive centers and legacy rows without an active flag.
  let query: FirebaseFirestore.Query = financialDbAdmin.collection("resultCenters");
  if (!scope.allUnits) query = query.where("unitIds", "array-contains-any", scope.unitIds);
  const docs = await query.select("name", "unitIds").limit(101).get();
  if (docs.size > 100) throw new BudgetDomainError("Há mais de 100 centros. Refine o acesso antes de consultar.");
  const centers = docs.docs.filter((doc) => scope.allUnits || (Array.isArray(doc.get("unitIds")) && doc.get("unitIds").length > 0
    && doc.get("unitIds").every((id: string) => canAccessUnit(actor.userDoc, id, { isDefaultAdmin: actor.isDefaultAdmin }))))
    .map((doc) => ({ id: doc.id, name: String(doc.get("name") || "Centro") }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { centers, allUnits: scope.allUnits };
}
