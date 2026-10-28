import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { recordRepPAvailabilityNotification } from '@/features/dp/rep-p/availability.server';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { WORKSPACE_ID } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };

const notificationSchema = z.object({
  incident: z.object({
    incident_id: z.string().min(1).max(256),
    state: z.enum(['open', 'closed']),
    started_at: z.number().int().positive(),
    // Cloud Monitoring sends `null` while an incident is open and a Unix
    // timestamp only after it closes. Preserve both wire representations.
    ended_at: z.number().int().positive().nullable().optional(),
    policy_name: z.string().min(1).max(512),
    condition_name: z.string().min(1).max(512),
  }),
});

type NotificationInput = z.infer<typeof notificationSchema>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'rep-p.availability-events.record',
  version: 1,
  surface: { method: 'POST', path: '/api/jobs/rep-p/availability-events' },
  exposure: 'internal-service',
  // A transição é deduplicada por incident_id no estado fiscal do REP-P;
  // por isso a identidade customizada declara a garantia de replay junto da autenticação.
  identity: { kind: 'custom', strategy: 'authenticated-monitor-relay',
    guarantees: ['authenticated-service', 'replay-protected'] },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'rep-p.availability-notification', unknownFields: 'strip' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown,
  { service: string }, NotificationInput, { workspaceId: string }>(contract, {
  authenticate({ request }) {
    const secret = process.env.REP_P_AVAILABILITY_MONITOR_SECRET?.trim();
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!secret || !authorized(token, secret)) throw new AppError({
      code: 'REP_P_AVAILABILITY_AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION',
      safeMessage: 'Não autorizado.', reportable: false,
    });
    return { service: 'cloud-monitoring-relay' };
  },
  async parseInput({ request }) {
    const parsed = notificationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'REP_P_AVAILABILITY_INPUT_INVALID', kind: 'VALIDATION',
      safeMessage: 'Notificação de disponibilidade inválida.' });
    return parsed.data;
  },
  loadResource: () => ({ workspaceId: WORKSPACE_ID }),
  assertScope: ({ resource }) => {
    if (resource.workspaceId !== WORKSPACE_ID) throw new AppError({
      code: 'REP_P_AVAILABILITY_WORKSPACE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Não autorizado.',
    });
  },
});

export const POST = secureRoute({ contract, enforcer,
  observability: { source: 'rep-p', operation: 'availability-event' } }, async ({ security }) => {
  const expectedPolicy = process.env.REP_P_AVAILABILITY_POLICY_NAME?.trim();
  const expectedCondition = process.env.REP_P_AVAILABILITY_CONDITION_NAME?.trim();
  const incident = security.input.incident;
  if (!expectedPolicy || !expectedCondition
    || incident.policy_name !== expectedPolicy || incident.condition_name !== expectedCondition) {
    throw new AppError({ code: 'REP_P_AVAILABILITY_SOURCE_MISMATCH', kind: 'AUTHORIZATION',
      safeMessage: 'A origem da notificação não confere.' });
  }
  const result = await recordRepPAvailabilityNotification(security.resource.workspaceId, {
    incidentId: incident.incident_id,
    state: incident.state,
    startedAt: incident.started_at,
    ...(incident.ended_at ? { endedAt: incident.ended_at } : {}),
    policyName: incident.policy_name,
    conditionName: incident.condition_name,
  });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
