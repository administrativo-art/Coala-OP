import type { ServerUserContext } from "@/lib/auth-server";
import type { HrAccess } from "@/features/hr/lib/server-access";
import { assertEmployeeUnitAccess, buildEmployeeDocumentAccessSubject, loadEmployeeDocumentAccessSettings } from "@/features/hr/lib/employee-document-access-server";
import { canAccessDocument } from "@/lib/hr/employee-document-access";
import { isOwnHrEmployeeId } from "@/lib/hr/person-link";
import { createUploadGuard } from "./upload-guard";

export async function uploadAccessFilter(actor: ServerUserContext) {
  const access: HrAccess = { ...actor, workspaceId: actor.workspace_id, actorName: "", canView: true, canManageCatalog: false, lookupError: null };
  const settings = await loadEmployeeDocumentAccessSettings(access);
  return createUploadGuard({
    async allowedPerson(employeeId) {
      if (actor.permissions.dp?.collaborators?.ownProfileOnly && employeeId !== actor.decoded.uid && !isOwnHrEmployeeId(actor.userDoc, employeeId)) return false;
      return assertEmployeeUnitAccess(access, employeeId).then(() => true, () => false);
    },
    allowedDocument: (item, employeeId) => canAccessDocument(
      { documentTypeCode: typeof item.documentTypeCode === "string" ? item.documentTypeCode : undefined, category: typeof item.category === "string" ? item.category : undefined, accessLevel: typeof item.accessLevel === "string" ? item.accessLevel : undefined },
      buildEmployeeDocumentAccessSubject(access, settings, employeeId), settings.visibilityConfig,
    ).allowed,
  });
}
