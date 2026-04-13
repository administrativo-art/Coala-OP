import { NextRequest, NextResponse } from 'next/server';
import { pushShiftToBizneo, type BizneoTimeRange } from '@/lib/integrations/bizneo-admin';

/**
 * Recebe os turnos já resolvidos do cliente e envia para o Bizneo.
 * Não acessa Firestore — toda a resolução de IDs é feita no cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const { shifts } = await req.json() as {
      shifts: {
        bizneoUserId: number;
        date: string;
        userName: string;
        timeRanges: BizneoTimeRange[];
        name?: string;
        taxonId?: number;
      }[];
    };

    if (!Array.isArray(shifts) || shifts.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum turno enviado.' }, { status: 400 });
    }

    const results: { date: string; user: string; status: 'ok' | 'error'; error?: string }[] = [];

    for (const shift of shifts) {
      try {
        await pushShiftToBizneo(shift.bizneoUserId, shift.date, shift.timeRanges, shift.name, shift.taxonId);
        results.push({ date: shift.date, user: shift.userName, status: 'ok' });
      } catch (e: any) {
        results.push({ date: shift.date, user: shift.userName, status: 'error', error: e.message });
      }
    }

    const ok = results.filter(r => r.status === 'ok').length;
    const errors = results.filter(r => r.status === 'error').length;

    return NextResponse.json({ success: true, ok, errors, results });
  } catch (e: any) {
    console.error('[Bizneo push-schedule]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
