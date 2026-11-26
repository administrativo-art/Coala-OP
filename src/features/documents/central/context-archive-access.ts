import type { PermissionSet } from "@/types";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { resolveUnitAccess, type UnitAccessUser } from "@/lib/unit-access";

export const CONTEXT_ARCHIVE_FOLDERS = {
  admissionUploads: { label: "Anexos da admissão" },
  aso: { label: "Guias de ASO" },
  accountant: { label: "Formulários para contabilidade" },
  paymentProof: { label: "Comprovantes de pagamento" },
  receipts: { label: "Meus comprovantes de ponto" },
  pilotReceipts: { label: "Meus comprovantes de ponto — ensaio" },
  afd: { label: "Arquivos fiscais AFD" },
  aej: { label: "Arquivos fiscais AEJ" },
  uniforms: { label: "Termos de uniforme" },
} as const;
export type ContextArchiveSource = keyof typeof CONTEXT_ARCHIVE_FOLDERS;
export const isContextArchiveSource = (value: unknown): value is ContextArchiveSource => typeof value === "string" && Object.hasOwn(CONTEXT_ARCHIVE_FOLDERS, value);
type Actor = { permissions: PermissionSet; isDefaultAdmin: boolean; userDoc: UnitAccessUser };
export function managesUniformArchive(actor: Actor) {
  return actor.isDefaultAdmin || actor.permissions.stock?.uniforms?.view === true
    || actor.permissions.dp?.collaborators?.view === true && !actor.permissions.dp.collaborators.ownProfileOnly;
}
export function canViewContextArchive(source: ContextArchiveSource, actor: Actor) {
  if (source === "admissionUploads") return hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin) && hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin);
  if (source === "receipts" || source === "pilotReceipts" || source === "uniforms") return true; // Only the authenticated person's records unless explicitly authorized otherwise.
  if (source === "aso" || source === "accountant") return hasFormalizationPermission(actor.permissions, source === "aso" ? "aso.view" : "accountant.view", actor.isDefaultAdmin);
  if (source === "paymentProof") return actor.isDefaultAdmin || Boolean(actor.permissions.financial?.view && actor.permissions.financial.paymentRequests?.view && actor.permissions.financial.paymentRequests.viewProof);
  return (actor.isDefaultAdmin || actor.permissions.dp?.settings?.manageTime === true)
    && resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits;
}

/** Missing workspace is accepted only under the existing global administrator policy. */
export function contextWorkspaceAllowed(record: Record<string, unknown>, workspaceId: string, admin: boolean) {
  return record.workspaceId == null ? admin : record.workspaceId === workspaceId;
}
