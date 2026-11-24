import { NextResponse } from 'next/server';
import { secureRoute } from '@/lib/security/secure-route.server';
import { portalLoginSchema } from '@/features/service-portal/schemas';
import { loginPortal } from '@/features/service-portal/auth.server';
import { publicPortalContract, publicPortalEnforcer, PORTAL_COOKIE, sessionCookieOptions } from '@/features/service-portal/route-security.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = secureRoute({
  contract: publicPortalContract('/api/service-portal/login'),
  enforcer: publicPortalEnforcer(portalLoginSchema),
}, async ({ security }) => {
  const result = await loginPortal(security.input.email, security.input.password);
  const response = NextResponse.json({ principal: result.principal, expiresAt: result.expiresAt }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(PORTAL_COOKIE, result.token, sessionCookieOptions(new Date(result.expiresAt)));
  return response;
});
