import { NextRequest, NextResponse } from 'next/server';

import { isPublicRecruitmentRequest } from '@/lib/public-recruitment-host';

/**
 * Domínio(s) público(s) dedicado(s) à landing de vagas.
 * Nesses hosts, a seção /vagas é servida a partir da raiz:
 *   vagas.coalashakes.com            -> /vagas
 *   vagas.coalashakes.com/banco...   -> /vagas/banco-de-talentos
 *   vagas.coalashakes.com/<slug>     -> /vagas/<slug>
 * Rotas internas do sistema (ex.: /dashboard) ficam bloqueadas nesse host.
 * Em qualquer outro host (op.coalashakes.com, *.run.app, localhost) o
 * middleware não faz nada.
 */
const BLOCKED_SYSTEM_PREFIXES = [
  '/dashboard',
  '/configuracoes',
  '/login',
  '/sistema',
  '/admin',
];

const PUBLIC_RECRUITMENT_API_PATHS = [
  '/api/hr/openings/public',
  '/api/hr/public-stats',
  '/api/hr/recruitment/forms/talent-pool/public',
  '/api/hr/apply',
  '/api/hr/talent',
  '/api/hr/upload',
];

function isAllowedPublicRecruitmentApi(pathname: string) {
  return PUBLIC_RECRUITMENT_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(req: NextRequest) {
  if (!isPublicRecruitmentRequest(req.headers)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const normalizedPathname = pathname.toLowerCase();

  if (normalizedPathname.startsWith('/api')) {
    return isAllowedPublicRecruitmentApi(normalizedPathname)
      ? NextResponse.next()
      : new NextResponse('Not found', { status: 404 });
  }

  // Assets do Next e arquivos estáticos passam intactos.
  if (
    normalizedPathname.startsWith('/_next') ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (BLOCKED_SYSTEM_PREFIXES.some((prefix) => normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Links absolutos /vagas/* -> redireciona para a URL limpa (sem /vagas).
  if (normalizedPathname === '/vagas' || normalizedPathname.startsWith('/vagas/')) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice('/vagas'.length) || '/';
    return NextResponse.redirect(url, 307);
  }

  // URL limpa -> reescreve internamente para a árvore /vagas.
  const url = req.nextUrl.clone();
  url.pathname = pathname === '/' ? '/vagas' : `/vagas${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
