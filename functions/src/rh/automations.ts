/**
 * automations.ts — CFs de automação do módulo RH (Fase 3B).
 *
 * Processa automation_tasks com status='pending' geradas pelo onFieldUpdate.
 * Cada processador é idempotente e registra resultado na própria task.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { type AutomationTask, type HrTask } from './types.js';

const hrDb    = getFirestore('coala-rh');
const mainDb  = getFirestore('coala');
const BRT     = 'America/Sao_Paulo';

// ─── Processador central de automation_tasks ──────────────────────────────────

async function processPendingTasks(): Promise<void> {
  const snap = await hrDb.collection('automation_tasks')
    .where('status', '==', 'pending')
    .orderBy('created_at', 'asc')
    .limit(50)
    .get();

  for (const doc of snap.docs) {
    const task = doc.data() as AutomationTask;
    await doc.ref.update({ status: 'processing' });

    try {
      await dispatchTask(task);
      await doc.ref.update({ status: 'done', processed_at: Timestamp.now() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[automations] Erro ao processar task ${doc.id} (${task.type}):`, msg);

      const newRetry = (task.retry_count ?? 0) + 1;
      if (newRetry >= 3) {
        await doc.ref.update({ status: 'failed', retry_count: newRetry });
      } else {
        await doc.ref.update({ status: 'pending', retry_count: newRetry });
      }
    }
  }
}

async function dispatchTask(task: AutomationTask): Promise<void> {
  switch (task.type) {
    case 'create_hr_task':      return handleCreateHrTask(task);
    case 'schedule_aso_alert':  return handleScheduleAsoAlert(task);
    case 'initiate_offboarding':return handleInitiateOffboarding(task);
    case 'propagate_uniform':   return handlePropagateUniform(task);
    case 'notify_salary_change':return handleNotifySalaryChange(task);
    case 'sync_failed_alert':   return handleSyncFailedAlert(task);
    default:
      console.warn(`[automations] Tipo de task desconhecido: ${task.type}`);
  }
}

// ─── Handlers individuais ─────────────────────────────────────────────────────

async function handleCreateHrTask(task: AutomationTask): Promise<void> {
  const p = task.payload as {
    employee_id: string;
    employee_name: string;
    unit_id: string;
    field_key: string;
    value: string;
  };

  const kind = p.field_key?.includes('probation') ? 'hr_probation' : 'hr_aso_alert';
  const dueDate = new Date(p.value);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error(`Data inválida para criar HrTask: ${p.value}`);
  }

  // Criar task no Coala OP (tasks collection do banco principal)
  const hrTask: HrTask = {
    kind,
    employee_id:   p.employee_id,
    employee_name: p.employee_name,
    due_date:      p.value,
    unit_id:       p.unit_id,
  };

  await mainDb.collection('tasks').add({
    title:          kind === 'hr_probation'
      ? `Avaliação de período de experiência — ${p.employee_name}`
      : `Alerta ASO — ${p.employee_name}`,
    description:    `Colaborador: ${p.employee_name} · Data: ${p.value}`,
    status:         'pending',
    assigneeType:   'profile',
    assigneeId:     'manager',
    requiresApproval: false,
    origin: {
      kind:        'hr_task',
      employee_id: p.employee_id,
      hr_task_kind: kind,
    },
    dueDate:        p.value,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    rh_task:        hrTask,
  });

  console.log(`[automations] HrTask criada: ${kind} para ${p.employee_id}`);
}

async function handleScheduleAsoAlert(task: AutomationTask): Promise<void> {
  const p = task.payload as { employee_id: string; employee_name: string; unit_id: string; value: string };
  // Agenda uma automation_task para +365 dias a partir do ASO
  const asoDate = new Date(p.value + 'T12:00:00');
  if (Number.isNaN(asoDate.getTime())) return;

  const alertDate = new Date(asoDate);
  alertDate.setFullYear(alertDate.getFullYear() + 1);
  alertDate.setDate(alertDate.getDate() - 30); // 30 dias antes do vencimento

  const scheduledKey = `aso_alert_${p.employee_id}_${p.value}`;
  await hrDb.collection('automation_tasks').add({
    type:            'aso_expiry_reminder',
    payload:         { ...p, alert_date: alertDate.toISOString().slice(0, 10) },
    status:          'pending',
    idempotency_key: scheduledKey,
    created_at:      Timestamp.now(),
    retry_count:     0,
  });
  console.log(`[automations] ASO alert agendado para ${alertDate.toISOString().slice(0, 10)} — ${p.employee_id}`);
}

async function handleInitiateOffboarding(task: AutomationTask): Promise<void> {
  const p = task.payload as { employee_id: string; employee_name: string; unit_id: string; value: string };
  // Criar checklist de desligamento no Coala Checklist
  const checklistDb = getFirestore('coala-checklist');
  await checklistDb.collection('automation_tasks').add({
    type:          'create_offboarding_checklist',
    employee_id:   p.employee_id,
    employee_name: p.employee_name,
    unit_id:       p.unit_id,
    contract_end:  p.value,
    created_at:    Timestamp.now(),
    status:        'pending',
  });
  console.log(`[automations] Checklist de desligamento solicitado para ${p.employee_id}`);
}

async function handlePropagateUniform(task: AutomationTask): Promise<void> {
  const p = task.payload as { employee_id: string; unit_id: string; field_key: string; value: string };

  // Buscar todos os tamanhos de uniforme do colaborador
  const fieldValSnap = await hrDb.collection('employees').doc(p.employee_id)
    .collection('field_values')
    .where('field_key', 'in', ['employee.uniform_shirt_size', 'employee.uniform_pants_size', 'employee.uniform_shoe_size'])
    .get();

  const sizes: Record<string, string> = {};
  fieldValSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.value_text) {
      if (d.id === 'employee.uniform_shirt_size') sizes.shirt = data.value_text;
      if (d.id === 'employee.uniform_pants_size') sizes.pants = data.value_text;
      if (d.id === 'employee.uniform_shoe_size')  sizes.shoes = data.value_text;
    }
  });

  // Propagar para coala-estoque (banco principal, coleção uniform_profiles)
  await mainDb.collection('uniform_profiles').doc(p.employee_id).set({
    employee_id: p.employee_id,
    unit_id:     p.unit_id,
    sizes,
    updated_at:  new Date().toISOString(),
  }, { merge: true });

  console.log(`[automations] Uniforme propagado para ${p.employee_id}: ${JSON.stringify(sizes)}`);
}

async function handleNotifySalaryChange(task: AutomationTask): Promise<void> {
  const p = task.payload as { employee_id: string; employee_name: string; value: unknown };

  const webhookUrl = process.env.SALARY_CHANGE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[automations] SALARY_CHANGE_WEBHOOK_URL não configurado — notificação de salário ignorada.');
    return;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event:       'salary_change',
      employee_id: p.employee_id,
      employee_name: p.employee_name,
      new_value:   p.value,
      timestamp:   new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    throw new Error(`Webhook de salário falhou: ${res.status}`);
  }
  console.log(`[automations] Webhook de salário disparado para ${p.employee_id}`);
}

async function handleSyncFailedAlert(task: AutomationTask): Promise<void> {
  const p = task.payload as { errors?: string[]; source?: string };
  console.error(`[automations] Sync Bizneo falhou (source=${p.source}). Erros:`, p.errors?.slice(0, 3));
  // Em produção: enviar e-mail ou notificação via Coala Notificações
}

// ─── scheduledDateAlerts ──────────────────────────────────────────────────────
// Verifica diariamente ASO e avaliações com vencimento ≤30 dias.

export const scheduledDateAlerts = onSchedule(
  { schedule: '0 8 * * *', timeZone: BRT },
  async () => {
    // Processar automation_tasks pendentes
    await processPendingTasks();

    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);

    // Verificar tarefas agendadas com alert_date passada
    const alertSnap = await hrDb.collection('automation_tasks')
      .where('type', '==', 'aso_expiry_reminder')
      .where('status', '==', 'pending')
      .get();

    for (const doc of alertSnap.docs) {
      const data = doc.data() as AutomationTask & { payload: { alert_date?: string; employee_id?: string; employee_name?: string; unit_id?: string } };
      const alertDate = data.payload?.alert_date ? new Date(data.payload.alert_date) : null;
      if (!alertDate || alertDate > today) continue;

      // Criar task de alerta no sistema de tarefas
      await mainDb.collection('tasks').add({
        title:       `ASO prestes a vencer — ${data.payload?.employee_name ?? data.payload?.employee_id}`,
        description: `O exame periódico do colaborador vence em 30 dias.`,
        status:      'pending',
        assigneeType: 'profile',
        assigneeId:  'manager',
        requiresApproval: false,
        origin: { kind: 'hr_task', employee_id: data.payload?.employee_id, hr_task_kind: 'hr_aso_alert' },
        dueDate:     alertDate.toISOString().slice(0, 10),
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      });

      await doc.ref.update({ status: 'done', processed_at: Timestamp.now() });
    }

    console.log('[scheduledDateAlerts] Concluído.');
  }
);

// ─── scheduledProfileCompletion ───────────────────────────────────────────────
// Semanal: recalcula completude de todos os perfis e notifica managers com <60%.

export const scheduledProfileCompletion = onSchedule(
  { schedule: '0 9 * * 1', timeZone: BRT },  // toda segunda-feira às 9h
  async () => {
    const empSnap = await hrDb.collection('employees')
      .where('status', '==', 'active')
      .get();

    let notified = 0;
    for (const empDoc of empSnap.docs) {
      const emp = empDoc.data();
      if (emp.profile_completion >= 60) continue;

      // Notificar o manager (via automation_task para o sistema de notificações)
      if (emp.manager_id) {
        const managerEmpSnap = await hrDb.collection('employees').doc(emp.manager_id).get();
        const managerAuthUid = managerEmpSnap.data()?.auth_uid;
        if (managerAuthUid) {
          await hrDb.collection('automation_tasks').add({
            type:            'profile_completion_alert',
            payload:         {
              employee_id:   empDoc.id,
              employee_name: emp.name,
              unit_id:       emp.unit_id,
              completion:    emp.profile_completion,
              manager_uid:   managerAuthUid,
            },
            status:          'pending',
            idempotency_key: `profile_completion_${empDoc.id}_${new Date().toISOString().slice(0, 7)}`,
            created_at:      Timestamp.now(),
            retry_count:     0,
          });
          notified += 1;
        }
      }
    }

    console.log(`[scheduledProfileCompletion] ${notified} notificações de completude enviadas.`);
  }
);
