import type { AbsenceRetentionCase, AbsenceRetentionState } from './retention-client';

export const retentionStates: Record<AbsenceRetentionState, { label: string; detail: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'danger' }> = {
  unanchored: { label: 'Sem marco de desligamento', detail: 'O prazo ainda depende de confirmação do marco de desligamento.', tone: 'neutral' },
  scheduled: { label: 'Revisão agendada', detail: 'Aguarda a data de revisão calculada para o documento.', tone: 'info' },
  awaiting_authorization: { label: 'Aguardando autorização', detail: 'O custodiante precisa decidir se autoriza a exclusão ou mantém o documento.', tone: 'warn' },
  authorized: { label: 'Exclusão autorizada', detail: 'O custodiante pode iniciar a remoção definitiva do arquivo.', tone: 'warn' },
  retained_until_review: { label: 'Mantido até nova revisão', detail: 'O documento permanece guardado até a próxima revisão indicada.', tone: 'info' },
  needs_revalidation: { label: 'Revalidação necessária', detail: 'O DP precisa conferir o vínculo e o marco de retenção. Não há decisão automática ou prazo presumido.', tone: 'warn' },
  execution_blocked: { label: 'Remoção bloqueada', detail: 'A exclusão física ainda não está habilitada. O documento permanece guardado.', tone: 'danger' },
  preparing_execution: { label: 'Preparando remoção', detail: 'O sistema está criando a trava de segurança do vínculo.', tone: 'info' },
  executing: { label: 'Remoção em andamento', detail: 'A geração autorizada do arquivo está sendo removida.', tone: 'info' },
  execution_unknown: { label: 'Conferindo remoção', detail: 'A resposta do armazenamento foi incerta. A trava permanece até a conferência automática.', tone: 'warn' },
  release_pending: { label: 'Finalizando remoção', detail: 'O arquivo já não está disponível; o sistema está concluindo o recibo e liberando o vínculo.', tone: 'info' },
  execution_review_required: { label: 'Revisão da remoção', detail: 'A versão do arquivo ou o vínculo mudou. A trava permanece até revisão humana.', tone: 'danger' },
  removed: { label: 'Removido', detail: 'O registro informa remoção concluída; a trilha da decisão permanece.', tone: 'neutral' },
};

export function canDecideRetention(value: AbsenceRetentionCase, actorUid: string | null) {
  return value.state === 'awaiting_authorization' && Boolean(actorUid)
    && value.custodianUid === actorUid && value.beneficiaryUid !== actorUid;
}

export function canExecuteRetention(value: AbsenceRetentionCase, actorUid: string | null) {
  return value.state === 'authorized' && Boolean(actorUid)
    && value.custodianUid === actorUid && value.beneficiaryUid !== actorUid;
}

export function retentionDecisionError(action: 'authorize_delete' | 'retain', reason: string, nextReviewAfter: string, today: string) {
  if (reason.trim().length < 10 || reason.trim().length > 1000) return 'Informe um motivo entre 10 e 1.000 caracteres.';
  if (action === 'retain' && (!nextReviewAfter || nextReviewAfter <= today)) return 'Informe uma próxima revisão futura.';
  return null;
}

export function belemCivilDate(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (kind: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === kind)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
