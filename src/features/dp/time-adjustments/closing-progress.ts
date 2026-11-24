export const CLOSING_PHASES = {
  awaiting_payslip: 'Aguardando contracheque', awaiting_review: 'Aguardando conferência',
  divergent: 'Com divergência', stale: 'Conferência desatualizada', ready: 'Pronto para assinatura',
  identity_pending: 'Cadastro RH pendente', missing_contact: 'Contato pendente', sending: 'Preparando envio', awaiting_signature: 'Aguardando assinatura',
  overdue: 'Assinatura atrasada', refused: 'Assinatura recusada', send_failed: 'Falha no envio',
  signed: 'Assinado e concluído', restricted: 'Conferência restrita',
} as const;
export type ClosingPhase = keyof typeof CLOSING_PHASES;
export function closingPhase(input: { packageStatus: string; overdue: boolean; document: boolean; contact: boolean; identity?: boolean; review: 'missing' | 'match' | 'divergent' | 'stale' | 'restricted' }): ClosingPhase {
  if (input.packageStatus === 'signed') return 'signed';
  if (input.packageStatus === 'refused') return 'refused';
  if (input.packageStatus === 'sent') return input.overdue ? 'overdue' : 'awaiting_signature';
  if (input.packageStatus === 'sending') return 'sending';
  if (input.review === 'restricted') return 'restricted';
  if (input.identity === false) return 'identity_pending';
  if (input.review === 'divergent') return 'divergent';
  if (input.review === 'stale') return 'stale';
  if (!input.document) return 'awaiting_payslip';
  if (input.review === 'missing') return 'awaiting_review';
  if (!input.contact) return 'missing_contact';
  if (input.packageStatus === 'failed') return 'send_failed';
  return 'ready';
}
