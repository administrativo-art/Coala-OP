import type { AbsenceRequestDto } from './workflow-types';

type Operational = NonNullable<AbsenceRequestDto['operational']>;

export function isOperationalPending(operational: AbsenceRequestDto['operational']) {
  return operational?.state === 'preparing' || operational?.state === 'activation_pending'
    || operational?.state === 'reversal_pending';
}

export function availableOperationalActions(operational: AbsenceRequestDto['operational']) {
  return {
    abort: operational?.state === 'preparing' && operational.canAbortPreparation === true,
    activate: operational?.state === 'activation_pending' && operational.canReconcile === true,
    reverse: operational?.state === 'reversal_pending' && operational.canReconcile === true,
  };
}

export function operationalPresentation(operational: Operational) {
  switch (operational.state) {
    case 'preparing': return { label: 'Preparação em andamento', detail: 'A decisão ainda não foi concluída. A preparação protege o período; as ações normais ficam bloqueadas.', tone: 'warn' as const };
    case 'activation_pending': return { label: 'Ativação pendente', detail: 'O pedido foi aprovado, mas o bloqueio operacional ainda não foi confirmado.', tone: 'warn' as const };
    case 'active': return operational.operationallyApplied
      ? { label: 'Bloqueio operacional ativo', detail: 'A disponibilidade está protegida. Isso não altera turnos nem marcações de ponto.', tone: 'ok' as const }
      : { label: 'Aplicação não confirmada', detail: 'Atualize o detalhe antes de considerar o bloqueio operacional ativo.', tone: 'warn' as const };
    case 'reversal_pending': return { label: 'Reversão pendente', detail: 'A decisão foi revertida, mas a liberação do bloqueio operacional ainda não foi confirmada.', tone: 'warn' as const };
    case 'reversed': return { label: 'Bloqueio revertido', detail: 'A reversão operacional foi registrada; o histórico do pedido permanece.', tone: 'neutral' as const };
  }
}
