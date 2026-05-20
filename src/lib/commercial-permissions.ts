import { type PermissionSet } from '@/types';

export function canViewTechnicalSheets(permissions?: PermissionSet | null) {
  return !!(
    permissions?.commercial?.technicalSheets?.view ||
    permissions?.dashboard?.technicalSheets
  );
}

export function canCreateTechnicalSheets(permissions?: PermissionSet | null) {
  return !!(
    permissions?.commercial?.technicalSheets?.create ||
    permissions?.pricing?.simulate
  );
}

export function canEditTechnicalSheets(permissions?: PermissionSet | null) {
  return !!(
    permissions?.commercial?.technicalSheets?.edit ||
    permissions?.pricing?.simulate
  );
}

export function canDeleteTechnicalSheets(permissions?: PermissionSet | null) {
  return !!(
    permissions?.commercial?.technicalSheets?.delete ||
    permissions?.pricing?.simulate
  );
}

export function canExportTechnicalSheets(permissions?: PermissionSet | null) {
  return !!(
    permissions?.commercial?.technicalSheets?.export ||
    permissions?.pricing?.simulate ||
    permissions?.dashboard?.technicalSheets
  );
}
