import type { NextRequest } from 'next/server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export async function getCompanyUserContext(request: NextRequest) {
  return requireUser(request).catch(() => null);
}

export function canLookupCompany(context: ServerUserContext) {
  const permissions = context.permissions;
  return (
    context.isDefaultAdmin ||
    permissions.registration.view ||
    permissions.registration.entities.add ||
    canViewPurchasing(permissions)
  );
}

export function canCreateCompany(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.registration.entities.add;
}

export function canUpdateCompany(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.registration.entities.edit;
}
