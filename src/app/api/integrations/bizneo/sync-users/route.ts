import { NextResponse } from 'next/server';

/**
 * Retorna a lista de usuários do Bizneo.
 * O cliente faz o match por email com os usuários locais e atualiza o Firestore diretamente.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'A importação de colaboradores do Bizneo está desativada. Cadastros devem ser feitos no Coala One.',
    },
    { status: 410 },
  );
}
