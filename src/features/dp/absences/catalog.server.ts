import 'server-only';

import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';

export type AbsenceCatalogDatabase = 'coala' | 'coala-rh';
export function absenceCatalogDatabase(): AbsenceCatalogDatabase {
  const configured = process.env.DP_ABSENCE_CATALOG_DATABASE;
  if (!configured || configured === 'coala') return 'coala';
  if (configured === 'coala-rh') return 'coala-rh';
  throw new AppError({ code: 'ABSENCE_CATALOG_CONFIG_INVALID', kind: 'UNEXPECTED_APPLICATION', safeMessage: 'Catálogo de ausências indisponível.' });
}
export function absenceCatalogStore() {
  return absenceCatalogDatabase() === 'coala-rh' ? hrDbAdmin : dbAdmin;
}

export async function absenceWorkflowReady() {
  if (absenceCatalogDatabase() !== 'coala-rh') return false;
  const receipt = await hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').get();
  return receipt.exists && receipt.get('state') === 'ready' && receipt.get('catalogDatabase') === 'coala-rh';
}

export async function requireAbsenceWorkflowReady() {
  if (!await absenceWorkflowReady()) throw new AppError({ code: 'ABSENCE_WORKFLOW_NOT_READY', kind: 'CONFLICT', safeMessage: 'Solicitações de ausência ainda não estão disponíveis.' });
}
