import { NextRequest, NextResponse } from 'next/server';
import { fetchBizneoUsers } from '@/lib/integrations/bizneo-admin';

/**
 * Retorna a lista de usuários do Bizneo.
 * O cliente faz o match por email com os usuários locais e atualiza o Firestore diretamente.
 */
export async function GET(_req: NextRequest) {
  try {
    const users = await fetchBizneoUsers();
    return NextResponse.json({ success: true, users });
  } catch (e: any) {
    console.error('[Bizneo sync-users]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
