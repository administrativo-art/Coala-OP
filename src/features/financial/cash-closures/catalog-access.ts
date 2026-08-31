import type { PermissionSet } from "@/types";
import { canAccessUnit, type UnitAccessUser } from "@/lib/unit-access";

type CashClosureCatalogContext = {
  isDefaultAdmin: boolean;
  permissions: Pick<PermissionSet, "financial">;
  userDoc: UnitAccessUser;
};

/**
 * A lista de unidades e competências faz parte do catálogo financeiro. Abrir o
 * calendário e os fechamentos diários continua protegido por cashClosures.view.
 */
export function canBrowseCashClosureCatalog(
  context: CashClosureCatalogContext,
  kioskId?: string | null,
) {
  if (context.isDefaultAdmin) return true;
  if (!context.permissions.financial?.view) return false;
  if (!kioskId) return true;
  return canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin });
}
