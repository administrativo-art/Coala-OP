import type { PermissionSet } from "@/types";

function isRouteWithin(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function canAccessDpRoute(permissions: PermissionSet, pathname: string) {
  if (permissions.dp?.view === true) return true;

  if (isRouteWithin(pathname, "/dashboard/dp/collaborators")) {
    return permissions.dp?.collaborators?.view === true;
  }

  if (isRouteWithin(pathname, "/dashboard/dp/requests")) {
    return permissions.dp?.requests?.view === true;
  }

  if (isRouteWithin(pathname, "/dashboard/dp/fechamento")) {
    return permissions.dp?.timeClosure?.close === true || permissions.dp?.timeClosure?.reopen === true;
  }

  return false;
}
