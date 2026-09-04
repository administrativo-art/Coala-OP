import type { PermissionSet } from "@/types";

function isRouteWithin(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function canAccessDpRoute(permissions: PermissionSet, pathname: string) {
  if (permissions.dp?.view === true) return true;

  if (isRouteWithin(pathname, "/dashboard/dp/collaborators")) {
    return permissions.dp?.collaborators?.view === true;
  }

  return false;
}
