import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

import { openSystemNotice, resolveSystemNotices } from '@/features/system-notices/service.server';
import { civilDateIn, repPCertificateMilestone, repPCertificateMilestoneSeverity } from '@/features/system-notices/core';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

import { inspectRepPIcpCredential } from './icp-signer';
import { REP_P_NORMS_REGISTRY, REP_P_NORMS_REVIEW_INTERVAL_DAYS } from './norms-registry';

const DEVELOPER_CNPJ = '14276603000125';
const PENDING_RECEIPT_GRACE_MS = 60 * 60_000;
const AUDIENCE = 'dp.time-manager-global' as const;

function brDate(instant: Date, timeZone: string) {
  const [year, month, day] = civilDateIn(instant, timeZone).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Rotina diária e idempotente: abre no máximo um aviso por marco/condição e resolve os superados.
 * Não lê nem registra a chave privada; só a validade do certificado configurado.
 */
export async function runRepPDailyMonitor(params: {
  workspaceId: string; now?: Date; timeZone?: string; signerPem?: string;
  database?: Firestore; repDatabase?: Firestore;
}) {
  const now = params.now ?? new Date();
  const timeZone = params.timeZone ?? 'America/Fortaleza';
  const database = params.database ?? dbAdmin;
  const repDatabase = params.repDatabase ?? hrDbAdmin;
  const { workspaceId } = params;
  const opened: string[] = [];
  const open = async (input: Omit<Parameters<typeof openSystemNotice>[0], 'workspaceId' | 'audience'>) => {
    const result = await openSystemNotice({ ...input, workspaceId, audience: AUDIENCE }, now, database);
    if (result.created) opened.push(input.dedupeKey);
    return input.dedupeKey;
  };

  // Certificado: um aviso por marco (60…0 dias e vencido) e por certificado; renovação resolve os antigos.
  const certificate = inspectRepPIcpCredential(params.signerPem ?? process.env.REP_P_ICP_SIGNER_PEM, DEVELOPER_CNPJ, now);
  let certificateKey: string | null = null;
  if (certificate.state === 'invalid') {
    certificateKey = await open({ category: 'rep-p.certificate', dedupeKey: `rep-p-certificate:invalid:${certificate.issue}`,
      severity: 'critical', title: 'Certificado de assinatura do ponto inválido',
      body: 'A credencial configurada não pôde ser usada; comprovantes e AFD ficam sem assinatura até a correção.',
      path: '/dashboard/system-notices' });
  } else if (certificate.state !== 'unconfigured') {
    const reached = repPCertificateMilestone(new Date(certificate.notAfter), now, timeZone);
    if (reached) {
      const expiresOn = brDate(new Date(certificate.notAfter), timeZone);
      const title = reached.milestone === 'expired' ? 'Certificado de assinatura do ponto vencido'
        : reached.milestone === 0 ? 'Certificado de assinatura do ponto vence hoje'
          : `Certificado de assinatura do ponto vence em ${reached.daysRemaining} ${reached.daysRemaining === 1 ? 'dia' : 'dias'}`;
      certificateKey = await open({ category: 'rep-p.certificate',
        dedupeKey: `rep-p-certificate:${certificate.fingerprint}:${reached.milestone}`,
        severity: repPCertificateMilestoneSeverity(reached.milestone), title,
        body: reached.milestone === 'expired'
          ? `O e-CNPJ venceu em ${expiresOn}. A assinatura de comprovantes e AFD está parada até um certificado novo ser cadastrado.`
          : `O e-CNPJ ${certificate.cnpj} vence em ${expiresOn}. Renove com a certificadora e envie o novo certificado ao Secret Manager.`,
        path: '/dashboard/system-notices' });
    }
  }
  await resolveSystemNotices({ workspaceId, category: 'rep-p.certificate',
    keepDedupeKeys: certificateKey ? [certificateKey] : [], reason: 'superseded_or_renewed' }, now, database);

  // Comprovantes pendentes há mais de 1 hora: um aviso por dia enquanto houver pendência.
  // Falha ao ler a ARP (banco ausente ou indisponível) não impede as demais checagens; fica no resultado.
  let pendingCount: number | null = null;
  try {
    const pending = await repDatabase.collection('repP_receipts').where('workspaceId', '==', workspaceId)
      .where('status', '==', 'pending').where('createdAt', '<=', Timestamp.fromMillis(now.getTime() - PENDING_RECEIPT_GRACE_MS))
      .count().get();
    pendingCount = pending.data().count;
  } catch {
    pendingCount = null;
  }
  const receiptKey = pendingCount === null ? null : pendingCount > 0 ? await open({ category: 'rep-p.receipts',
    dedupeKey: `rep-p-receipts:pending:${civilDateIn(now, timeZone)}`, severity: 'warning',
    title: `${pendingCount} ${pendingCount === 1 ? 'comprovante de ponto pendente' : 'comprovantes de ponto pendentes'}`,
    body: 'Há batidas registradas cujo comprovante ainda não foi assinado. As batidas estão gravadas; confira a assinatura.',
    path: '/dashboard/system-notices' }) : null;
  if (pendingCount !== null) {
    await resolveSystemNotices({ workspaceId, category: 'rep-p.receipts', keepDedupeKeys: receiptKey ? [receiptKey] : [],
      reason: 'no_pending_receipts' }, now, database);
  }

  // Revisão das normas: vencida quando nunca feita ou há mais de 30 dias.
  const lastReviewed = REP_P_NORMS_REGISTRY.lastReviewedAt;
  const overdue = !lastReviewed
    || now.getTime() - Date.parse(`${lastReviewed}T00:00:00Z`) > REP_P_NORMS_REVIEW_INTERVAL_DAYS * 86_400_000;
  const normsKey = overdue ? await open({ category: 'rep-p.norms-review',
    dedupeKey: `rep-p-norms-review:${lastReviewed ?? 'never'}`, severity: 'warning',
    title: lastReviewed ? 'Revisão das normas do ponto vencida' : 'Normas do ponto ainda não conferidas',
    body: lastReviewed
      ? `A última conferência da Portaria 671 e normas relacionadas foi em ${lastReviewed.split('-').reverse().join('/')}. Peça ao Doc Brown a revisão de vigência.`
      : 'O registro de normas do REP-P ainda não foi conferido. Peça ao Doc Brown a conferência das fontes oficiais.',
    path: '/dashboard/system-notices' }) : null;
  await resolveSystemNotices({ workspaceId, category: 'rep-p.norms-review', keepDedupeKeys: normsKey ? [normsKey] : [],
    reason: 'norms_reviewed' }, now, database);

  return { certificateState: certificate.state, pendingReceipts: pendingCount, receiptsCheck: pendingCount === null ? 'unavailable' as const : 'ok' as const,
    normsReviewOverdue: overdue, opened };
}
