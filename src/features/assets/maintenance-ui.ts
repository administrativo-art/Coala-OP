import type { AssetHistoryMaintenance } from './history-pagination';

export const MAINTENANCE_LIMITS = { description: 3000, assignee: 200, components: 30, component: 200 } as const;

export function formatMaintenanceDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem', dateStyle: 'short', ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Realizada', scheduled: 'Agendada', open: 'Aberta', cancelled: 'Cancelada',
};

export function maintenanceStatus(status?: string | null) {
  return STATUS_LABELS[status ?? ''] ?? 'Situação não informada';
}

export function maintenanceHistoryDetails(maintenance: AssetHistoryMaintenance, description: string) {
  const completed = maintenance.status === 'completed';
  const status = maintenanceStatus(maintenance.status);
  return {
    title: maintenance.status && STATUS_LABELS[maintenance.status] ? `Manutenção ${status.toLocaleLowerCase('pt-BR')}` : 'Manutenção',
    status,
    date: formatMaintenanceDate(completed ? maintenance.performedOn ?? maintenance.completedAt : maintenance.dueDate),
    dateLabel: completed ? 'Realizada em' : 'Concluir até',
    service: maintenance.result || description,
  };
}

type MaintenanceInput = {
  mode: 'scheduled' | 'completed';
  key: string;
  date: string;
  today: string;
  description: string;
  assignee: string;
  components: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  user: { id: string; username: string };
  occurrence?: { id: string; version: number } | null;
};

export type MaintenanceErrors = Partial<Record<'date' | 'description' | 'assignee' | 'components', string>>;

export function prepareMaintenanceRequest(input: MaintenanceInput) {
  const { mode, date, today, occurrence } = input;
  const completed = mode === 'completed';
  const description = input.description.trim();
  const assigneeName = input.assignee.trim();
  const components = input.components.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errors: MaintenanceErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    errors.date = 'Informe uma data válida.';
  } else if (completed && date > today) {
    errors.date = 'A data da realização deve ser hoje ou anterior.';
  }
  if (!description) errors.description = completed ? 'Descreva o serviço realizado.' : 'Descreva o problema.';
  else if (description.length > MAINTENANCE_LIMITS.description) errors.description = 'Use até 3.000 caracteres.';
  if (!occurrence && assigneeName.length > MAINTENANCE_LIMITS.assignee) errors.assignee = 'Use até 200 caracteres.';
  if (completed && components.length > MAINTENANCE_LIMITS.components) errors.components = 'Informe até 30 peças, uma por linha.';
  else if (completed && components.some((line) => line.length > MAINTENANCE_LIMITS.component)) errors.components = 'Use até 200 caracteres por linha.';
  if (Object.keys(errors).length) return { errors };

  const assignee = assigneeName
    ? { type: 'third_party', nameSnapshot: assigneeName }
    : { type: 'user', id: input.user.id, nameSnapshot: input.user.username };
  if (completed && occurrence) {
    return { body: { expectedVersion: occurrence.version, performedOn: date, result: description, components } };
  }
  if (completed) {
    return { body: { mode, idempotencyKey: input.key, performedOn: date, description, assignee, components } };
  }
  return {
    body: { idempotencyKey: input.key, dueDate: date, priority: input.priority, assignee, description, checklistSnapshot: [], components: [] },
  };
}
