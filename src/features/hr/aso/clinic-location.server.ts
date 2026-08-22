import { clinicLocationFromConfig } from '@/features/hr/aso/clinic-location';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveAsoClinicLocation(clinicEntityId: string, fallbackName?: string | null) {
  if (!clinicEntityId) return null;
  const [clinicSnapshot, entitySnapshot] = await Promise.all([
    hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get(),
    dbAdmin.collection('entities').doc(clinicEntityId).get(),
  ]);
  if (!clinicSnapshot.exists || !entitySnapshot.exists) return null;
  const name = text(entitySnapshot.get('name'))
    || text(entitySnapshot.get('razao_social'))
    || text(fallbackName)
    || 'Clínica do ASO';
  return clinicLocationFromConfig(name, clinicSnapshot.get('address'));
}
