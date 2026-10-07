import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { ignoreNoticeSchema } from '@/lib/pending-purchase-notice-policy';
import { ignorePendingPurchaseNotice } from '@/lib/pending-purchase-notice-store';
import { withApiErrorHandling } from '@/lib/observability/api-error';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const POST = withApiErrorHandling({ source: 'api-purchasing', operation: 'ignore-pending-purchase-notice',
  routeOrJob: '/api/purchasing/pending-by-destination/ignore' }, async (request: NextRequest) => {
  let user;
  try { user = await requireUser(request); } catch (error) { rethrowServerAuthenticationFailure(error); }
  const parsed = ignoreNoticeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AppError({ code: 'NOTICE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Aviso ou motivo inválido.' });
  const result = await ignorePendingPurchaseNotice(dbAdmin, user, parsed.data);
  if (result === 'not_found') throw new AppError({ code: 'NOTICE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Aviso não encontrado.' });
  return NextResponse.json({ ok: true, status: result });
});
