import { z } from 'zod';
import { NextResponse } from 'next/server';
import { revokePortalSession } from '@/features/service-portal/auth.server';
import { publicPortalContract, publicPortalEnforcer, PORTAL_COOKIE, sessionCookieOptions } from '@/features/service-portal/route-security.server';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = secureRoute({
  contract: publicPortalContract('/api/service-portal/logout'),
  enforcer: publicPortalEnforcer(z.object({}).strict()),
}, async ({ request }) => {
  const token = request.cookies.get(PORTAL_COOKIE)?.value;
  if (token) await revokePortalSession(token);
  const response = NextResponse.json({ loggedOut: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(PORTAL_COOKIE, '', sessionCookieOptions(new Date(0)));
  return response;
});
