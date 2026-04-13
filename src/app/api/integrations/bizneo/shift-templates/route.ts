import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://coala.bizneohr.com/api/v1';

export type BizneoShiftTemplate = {
  name: string;
  timeRanges: { start_at: string; end_at: string }[];
};

/**
 * Varre as schedules de todos os usuários nos últimos 60 dias e coleta
 * os time_ranges reais de cada modelo de one-time-schedule único.
 * Retorna um mapa name → BizneoShiftTemplate.
 */
export async function GET(_req: NextRequest) {
  try {
    const token = process.env.BIZNEO_TOKEN;
    if (!token) throw new Error('BIZNEO_TOKEN não configurado.');

    // 1. Busca todos os usuários
    const usersRes = await fetch(`${BASE_URL}/users?token=${token}&page_size=100`, {
      headers: { Accept: 'application/json' },
    });
    if (!usersRes.ok) throw new Error(`Bizneo users: ${usersRes.status}`);
    const { users } = await usersRes.json();

    // 2. Janela de 30 dias passados + 90 dias futuros para capturar todos os templates
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    const end = new Date(now);
    end.setDate(end.getDate() + 180);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // 3. Para cada usuário, busca schedules e coleta pares name → time_ranges
    const seen = new Map<string, { start_at: string; end_at: string }[]>();

    await Promise.allSettled(
      (users as { id: number }[]).map(async (u) => {
        try {
          const res = await fetch(
            `${BASE_URL}/users/${u.id}/schedules?token=${token}&start_at=${fmt(start)}&end_at=${fmt(end)}`,
            { headers: { Accept: 'application/json' } }
          );
          if (!res.ok) return;
          const { day_details } = await res.json();
          for (const day of day_details ?? []) {
            if (day.kind !== 'one_time_schedule' || !day.time_ranges?.length) continue;
            const name = String(day.one_time_schedule || day.name || '').trim();
            if (name && !seen.has(name)) {
              seen.set(name, day.time_ranges.map((r: any) => ({
                start_at: r.start_at,
                end_at: r.end_at,
              })));
            }
          }
        } catch { /* ignore per-user errors */ }
      })
    );

    const templates: BizneoShiftTemplate[] = Array.from(seen.entries()).map(([name, timeRanges]) => ({ name, timeRanges }));
    return NextResponse.json({ success: true, templates });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
