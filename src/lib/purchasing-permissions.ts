import { type PermissionSet } from '@/types';

export function canViewPurchasing(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.view ||
    permissions?.stock?.purchasing?.view,
  );
}

export function canCreateQuotation(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.createQuotation ||
    permissions?.stock?.purchasing?.suggest,
  );
}

export function canFinalizeQuotation(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.finalizeQuotation ||
    permissions?.stock?.purchasing?.suggest,
  );
}

export function canCreatePurchase(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.createPurchase ||
    permissions?.stock?.purchasing?.approve,
  );
}

export function canReceivePurchase(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.receivePurchase ||
    permissions?.stock?.purchasing?.approve,
  );
}

export function canManagePurchaseFinancials(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.manageFinancialLink ||
    canReceivePurchase(permissions),
  );
}

export function canCancelPurchase(permissions?: PermissionSet | null) {
  return Boolean(
    permissions?.purchasing?.cancelPurchase ||
    canCreatePurchase(permissions) ||
    canReceivePurchase(permissions),
  );
}
