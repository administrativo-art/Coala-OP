import { NextRequest, NextResponse } from 'next/server';

import { pushShiftToBizneo } from '@/lib/integrations/bizneo-admin';
import { assertBizneoAccess, BizneoAccessError } from '@/lib/integrations/bizneo-access';
import { pushBizneoScheduleSchema } from '@/lib/integrations/bizneo-schedule-contract';
import { AppError, reportSystemError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/integrations/bizneo/push-schedule';

/**
 * Publica no Bizneo turnos já resolvidos pelo cliente.
 * O alvo externo é único por colaborador/data; o schema rejeita alvos duplicados
 * antes da primeira escrita e `dryRun` permite validar o lote sem chamar o Bizneo.
 */
export const POST = withApiErrorHandling({
  source: 'api-integrations',
  operation: 'publish-bizneo-schedule',
  routeOrJob: ROUTE,
}, async (request: NextRequest, _context, observation) => {
  const access = await assertBizneoAccess(request, 'schedules').catch((cause) => {
    if (cause instanceof BizneoAccessError) {
      throw new AppError({
        code: cause.status === 401 ? 'BIZNEO_AUTHENTICATION_REQUIRED' : 'BIZNEO_SCHEDULE_FORBIDDEN',
        kind: cause.status === 401 ? 'AUTHENTICATION' : 'AUTHORIZATION',
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });

  if (!access.isDefaultAdmin && !access.permissions.dp.schedules.export) {
    throw new AppError({
      code: 'BIZNEO_SCHEDULE_PUBLISH_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para publicar escalas no Bizneo.',
    });
  }

  const parsed = pushBizneoScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: 'BIZNEO_SCHEDULE_PAYLOAD_INVALID',
      kind: 'VALIDATION',
      safeMessage: 'Os turnos enviados ao Bizneo são inválidos.',
      cause: parsed.error,
    });
  }

  if (parsed.data.dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      planned: parsed.data.shifts.length,
      targets: parsed.data.shifts.map((shift) => ({
        bizneoUserId: shift.bizneoUserId,
        date: shift.date,
        name: shift.name ?? null,
        taxonId: shift.taxonId ?? null,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const results: Array<{
    date: string;
    user: string;
    status: 'ok' | 'error';
    publicationState?: 'published';
    error?: string;
    eventId?: string;
  }> = [];

  for (const shift of parsed.data.shifts) {
    try {
      await pushShiftToBizneo(
        shift.bizneoUserId,
        shift.date,
        shift.timeRanges,
        shift.name,
        shift.taxonId,
      );
      results.push({
        date: shift.date,
        user: shift.userName,
        status: 'ok',
        publicationState: 'published',
      });
    } catch (error) {
      const reference = reportSystemError({
        error,
        source: 'api-integrations',
        operation: 'publish-bizneo-schedule-item',
        routeOrJob: ROUTE,
        requestId: observation.requestId,
        correlationId: observation.correlationId,
        code: 'BIZNEO_SCHEDULE_ITEM_FAILED',
        kind: 'TRANSIENT_EXTERNAL',
        metadata: {
          bizneoUserId: shift.bizneoUserId,
          date: shift.date,
          taxonId: shift.taxonId,
        },
      });
      results.push({
        date: shift.date,
        user: shift.userName,
        status: 'error',
        error: 'Falha ao publicar este turno no Bizneo.',
        eventId: reference.eventId,
      });
    }
  }

  const ok = results.filter((result) => result.status === 'ok').length;
  const errors = results.length - ok;

  return NextResponse.json({
    success: errors === 0,
    dryRun: false,
    ok,
    errors,
    results,
  }, {
    status: errors === 0 ? 200 : ok > 0 ? 207 : 502,
    headers: { 'Cache-Control': 'no-store' },
  });
});
