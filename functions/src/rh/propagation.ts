/**
 * propagation.ts — CFs de propagação entre módulos (Fase 3C).
 *
 * checkFieldMapConsistency: semanal, compara field_map vs API Bizneo.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { listCustomFieldDefinitions } from './bizneo-client.js';
import { type FieldMap } from './types.js';

const hrDb = getFirestore('coala-rh');
const BRT  = 'America/Sao_Paulo';

// ─── checkFieldMapConsistency ────────────────────────────────────────────────
// Semanal: verifica se os bizneo_ids do field_map ainda existem na API.

export const checkFieldMapConsistency = onSchedule(
  { schedule: '0 4 * * 0', timeZone: BRT },  // domingo às 4h
  async () => {
    const fieldMapSnap = await hrDb.collection('schema').doc('field_map').get();
    if (!fieldMapSnap.exists) {
      console.warn('[checkFieldMapConsistency] field_map não encontrado.');
      return;
    }

    const fieldMap = fieldMapSnap.data() as FieldMap;
    const bizneoFields = await listCustomFieldDefinitions();

    if (bizneoFields.length === 0) {
      console.warn('[checkFieldMapConsistency] Nenhum campo retornado pela API Bizneo (PENDING_DISCOVERY ou indisponível).');
      return;
    }

    const bizneoIds = new Set(bizneoFields.map((f) => String(f.id)));
    const divergences: string[] = [];

    for (const [coalaKey, entry] of Object.entries(fieldMap.fields)) {
      if (entry.bizneo_id === 'PENDING_DISCOVERY') continue;
      if (!bizneoIds.has(entry.bizneo_id)) {
        divergences.push(`${coalaKey}: bizneo_id="${entry.bizneo_id}" não encontrado na API`);
      }
    }

    if (divergences.length > 0) {
      console.error('[checkFieldMapConsistency] Divergências encontradas:', divergences);
      // Criar tarefa de alerta para admin
      await hrDb.collection('automation_tasks').add({
        type:            'field_map_divergence_alert',
        payload:         { divergences, checked_at: new Date().toISOString() },
        status:          'pending',
        idempotency_key: `field_map_check_${new Date().toISOString().slice(0, 10)}`,
        created_at:      Timestamp.now(),
        retry_count:     0,
      });
    } else {
      console.log('[checkFieldMapConsistency] Sem divergências detectadas.');
    }
  }
);
