import type { PermissionSet } from '@/types';

/**
 * Públicos de avisos do sistema. Cada aviso declara um público; só vê o aviso quem pertence a ele
 * e também pode abrir a central. Adicionar público novo exige a regra aqui e o teste correspondente.
 */
export const SYSTEM_NOTICE_AUDIENCES = ['system.admin', 'dp.time-manager-global', 'dp.time-closure'] as const;
export type SystemNoticeAudience = typeof SYSTEM_NOTICE_AUDIENCES[number];
export type SystemNoticeSeverity = 'info' | 'warning' | 'critical';
export type SystemNoticeCategory = 'rep-p.certificate' | 'rep-p.clock' | 'rep-p.receipts' | 'rep-p.norms-review' | 'dp.time-closing';

export type SystemNoticeActor = Readonly<{
  isDefaultAdmin: boolean;
  permissions: Pick<PermissionSet, 'settings'> & { dp: { settings: { manageTime?: boolean }; timeClosure?: { close?: boolean } } };
  allUnits: boolean;
}>;

export function canViewSystemNotices(actor: SystemNoticeActor): boolean {
  return actor.isDefaultAdmin
    || (actor.permissions.settings.view === true && actor.permissions.settings.viewSystemNotices === true);
}

export function belongsToSystemNoticeAudience(actor: SystemNoticeActor, audience: SystemNoticeAudience): boolean {
  if (actor.isDefaultAdmin) return true;
  switch (audience) {
    case 'system.admin': return false;
    // Mesma regra da exportação do AFD: gestor de Tempo com acesso a todas as unidades.
    case 'dp.time-manager-global': return actor.permissions.dp.settings.manageTime === true && actor.allUnits;
    // Responsáveis pelo fechamento do mês: quem pode fechar a competência.
    case 'dp.time-closure': return actor.permissions.dp.timeClosure?.close === true;
  }
}

/** Públicos visíveis ao ator, já combinados com o acesso à central; vazio quando não pode abrir a central. */
/**
 * Público que recebe o aviso no sino mesmo sem acesso à central de avisos: o aviso leva direto à tela onde se trata
 * (ex.: o fechamento do mês, para quem fecha).
 */
export const BELL_WITHOUT_CENTRAL: readonly SystemNoticeAudience[] = ['dp.time-closure'];

export function systemNoticeAudiencesFor(actor: SystemNoticeActor): SystemNoticeAudience[] {
  if (!canViewSystemNotices(actor)) return [];
  return SYSTEM_NOTICE_AUDIENCES.filter((audience) => belongsToSystemNoticeAudience(actor, audience));
}

export const REP_P_CERTIFICATE_MILESTONES = [60, 45, 30, 15, 7, 5, 4, 3, 2, 1, 0] as const;
export type RepPCertificateMilestone = typeof REP_P_CERTIFICATE_MILESTONES[number] | 'expired';

/** Data civil (AAAA-MM-DD) de um instante no fuso operacional. */
export function civilDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function civilDayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Marco vigente do vencimento em dias civis do fuso: 0 é o próprio dia do vencimento,
 * `expired` começa no instante seguinte ao fim da validade. Fora da janela de 60 dias, null.
 */
export function repPCertificateMilestone(notAfter: Date, now: Date, timeZone: string): { milestone: RepPCertificateMilestone; daysRemaining: number } | null {
  if (now.getTime() > notAfter.getTime()) return { milestone: 'expired', daysRemaining: -1 };
  const daysRemaining = civilDayDifference(civilDateIn(now, timeZone), civilDateIn(notAfter, timeZone));
  const reached = REP_P_CERTIFICATE_MILESTONES.filter((milestone) => daysRemaining <= milestone);
  return reached.length ? { milestone: reached[reached.length - 1], daysRemaining } : null;
}

export function repPCertificateMilestoneSeverity(milestone: RepPCertificateMilestone): SystemNoticeSeverity {
  if (milestone === 'expired' || milestone <= 7) return 'critical';
  return milestone <= 30 ? 'warning' : 'info';
}
