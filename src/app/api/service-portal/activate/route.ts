import { NextResponse } from 'next/server';
import { secureRoute } from '@/lib/security/secure-route.server';
import { portalActivationSchema } from '@/features/service-portal/schemas';
import { activatePortalInvitation } from '@/features/service-portal/auth.server';
import { publicPortalContract, publicPortalEnforcer } from '@/features/service-portal/route-security.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = secureRoute({
  contract: publicPortalContract('/api/service-portal/activate'),
  enforcer: publicPortalEnforcer(portalActivationSchema),
}, async ({ security }) => {
  await activatePortalInvitation(security.input.token, security.input.password);
  return NextResponse.json({ activated: true }, { headers: { 'Cache-Control': 'private, no-store' } });
});
