import { NextRequest, NextResponse } from 'next/server';
import { fetchBizneoUsers } from '@/lib/integrations/bizneo-admin';
import { assertBizneoAccess, BizneoAccessError } from '@/lib/integrations/bizneo-access';

/**
 * Retorna a lista de usuários do Bizneo.
 * O cliente faz o match por email com os usuários locais e atualiza o Firestore diretamente.
 */
export async function GET(req: NextRequest) {
  try {
    await assertBizneoAccess(req, 'users');
    const users = await fetchBizneoUsers();
    return NextResponse.json({ success: true, users });
  } catch (e: any) {
    if (!(e instanceof BizneoAccessError)) {
      console.error('[Bizneo sync-users]', e);
    }
    const message = e instanceof Error ? e.message : 'Falha ao sincronizar usuários do Bizneo.';
    const status = e instanceof BizneoAccessError ? e.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
