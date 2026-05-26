/**
 * termination.ts — CF onTermination (Fase 4-07)
 *
 * Disparada quando employees.status muda para 'terminated'.
 * Aplica a política de retenção LGPD: hard delete de dados bancários e foto.
 */

import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const hrDb = getFirestore('coala-rh');
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? 'smart-converter-752gf.firebasestorage.app';

const BANK_FIELDS = [
  'employee.bank_name',
  'employee.bank_agency',
  'employee.bank_account',
  'employee.pix_key',
];

export const onTermination = onDocumentWritten(
  { database: 'coala-rh', document: 'employees/{bizneoId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();

    // Só processa quando status muda para 'terminated'
    if (!after || after.status !== 'terminated' || before?.status === 'terminated') return;

    const bizneoId = event.params.bizneoId;
    const now = Timestamp.now();

    // ── Calcular datas de exclusão conforme política LGPD ─────────────────
    const terminatedAt = now.toDate();

    // Dados bancários: excluir após 90 dias
    const bankDeleteAt = new Date(terminatedAt);
    bankDeleteAt.setDate(bankDeleteAt.getDate() + 90);

    // Foto: excluir após 30 dias
    const photoDeleteAt = new Date(terminatedAt);
    photoDeleteAt.setDate(photoDeleteAt.getDate() + 30);

    // ── Agendar exclusão de dados bancários (via automation_task) ─────────
    for (const fieldKey of BANK_FIELDS) {
      await hrDb.collection('automation_tasks').add({
        type:            'lgpd_field_delete',
        payload:         { employee_id: bizneoId, field_key: fieldKey, delete_at: bankDeleteAt.toISOString() },
        status:          'pending',
        idempotency_key: `lgpd_delete_${bizneoId}_${fieldKey}`,
        created_at:      now,
        retry_count:     0,
      });
    }

    // ── Agendar exclusão de foto ──────────────────────────────────────────
    await hrDb.collection('automation_tasks').add({
      type:            'lgpd_photo_delete',
      payload:         {
        employee_id: bizneoId,
        photo_url:   after.photo_url ?? null,
        delete_at:   photoDeleteAt.toISOString(),
      },
      status:          'pending',
      idempotency_key: `lgpd_photo_${bizneoId}`,
      created_at:      now,
      retry_count:     0,
    });

    // ── TTL para dados pessoais: expires_at = +5 anos ─────────────────────
    const expiresAt = new Date(terminatedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 5);

    await hrDb.collection('employees').doc(bizneoId).update({
      expires_at: Timestamp.fromDate(expiresAt),
    });

    // ── Gravar audit_log da rescisão ──────────────────────────────────────
    await hrDb.collection('audit_log').add({
      employee_id: bizneoId,
      field_key:   'employee.status',
      old_value:   before?.status ?? 'unknown',
      new_value:   'terminated',
      changed_by:  'cf_termination',
      changed_at:  now,
      source:      'cf_automation',
    });

    console.log(`[onTermination] ${bizneoId}: dados bancários agendados para exclusão em ${bankDeleteAt.toISOString().slice(0, 10)}, foto em ${photoDeleteAt.toISOString().slice(0, 10)}.`);
  }
);

// ─── lgpdScheduledCleanup ─────────────────────────────────────────────────────
// Mensal: processa automation_tasks do tipo lgpd_field_delete e lgpd_photo_delete.

import { onSchedule } from 'firebase-functions/v2/scheduler';
const BRT = 'America/Sao_Paulo';

export const lgpdScheduledCleanup = onSchedule(
  { schedule: '0 2 1 * *', timeZone: BRT },  // 1º dia do mês às 2h
  async () => {
    const now = new Date();

    const snap = await hrDb.collection('automation_tasks')
      .where('type', 'in', ['lgpd_field_delete', 'lgpd_photo_delete'])
      .where('status', '==', 'pending')
      .get();

    let deleted = 0;

    for (const doc of snap.docs) {
      const task = doc.data() as { type: string; payload: Record<string, unknown>; idempotency_key: string };
      const deleteAt = new Date(task.payload.delete_at as string);
      if (deleteAt > now) continue;

      try {
        if (task.type === 'lgpd_field_delete') {
          const { employee_id, field_key } = task.payload as { employee_id: string; field_key: string };
          await hrDb.collection('employees').doc(employee_id)
            .collection('field_values').doc(field_key).delete();

          await hrDb.collection('audit_log').add({
            employee_id,
            field_key,
            old_value:  '[REDACTED por LGPD]',
            new_value:  null,
            changed_by: 'cf_lgpd_cleanup',
            changed_at: Timestamp.now(),
            source:     'cf_automation',
          });

        } else if (task.type === 'lgpd_photo_delete') {
          const { employee_id, photo_url } = task.payload as { employee_id: string; photo_url: string | null };

          if (photo_url) {
            // Extrair path do Storage a partir da URL
            const urlObj = new URL(photo_url);
            const encodedPath = urlObj.searchParams.get('name') ?? urlObj.pathname.split('/o/')[1];
            if (encodedPath) {
              const storagePath = decodeURIComponent(encodedPath);
              try {
                await getStorage().bucket(STORAGE_BUCKET).file(storagePath).delete();
              } catch (_) { /* arquivo pode já ter sido deletado */ }
            }
          }

          await hrDb.collection('employees').doc(employee_id).update({
            photo_url: FieldValue.delete(),
          });
        }

        await doc.ref.update({ status: 'done' });
        deleted += 1;
      } catch (err) {
        console.error(`[lgpdScheduledCleanup] Erro ao processar ${doc.id}:`, err);
        await doc.ref.update({ status: 'failed', retry_count: FieldValue.increment(1) });
      }
    }

    console.log(`[lgpdScheduledCleanup] ${deleted} itens deletados por LGPD.`);
  }
);
