import type { PermissionSet } from "@/types";

/** Quem recebe o diretório completo de usuários no AuthProvider; os demais veem só o próprio cadastro. */
export function canReadUsersDirectory(permissions: PermissionSet) {
  return (
    permissions.settings.manageUsers ||
    (permissions.dp?.collaborators?.view === true && permissions.dp?.collaborators?.ownProfileOnly !== true) ||
    permissions.dp?.collaborators?.edit === true ||
    permissions.dp?.collaborators?.terminate === true
  );
}
