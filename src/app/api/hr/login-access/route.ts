import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  DEFAULT_LOGIN_ACCESS_TIMEZONE,
  evaluateLoginRestriction,
  getLoginRestrictionProbeDates,
  LOGIN_RESTRICTION_EXTENSION_MINUTES,
  type LoginRestrictionJustificationInput,
  type LoginRestrictionShiftInput,
} from "@/features/hr/lib/login-access";
import { assertHrAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { logAction } from "@/lib/log-action";
import { verifyAuth } from "@/lib/verify-auth";
import { readOfficialPersonMonth, readOfficialScheduleShifts } from '@/features/dp/schedules/official-revision.server';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const justificationSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  justificationText: z.string().trim().min(5).max(2000),
}).strict();

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'hr.login-access.get', version: 1,
  surface: { method: 'GET', path: '/api/hr/login-access' }, exposure: 'authenticated',
  identity: { kind: 'custom', strategy: 'firebase-auth-token', guarantees: ['authenticated-user'] },
  authorization: { kind: 'custom', strategy: 'self-or-hr-manage' },
  resourceScope: { kind: 'custom', strategy: 'self-or-hr-managed-user' },
  input: { kind: 'schema', schema: 'hr.login-access-query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'hr.login-access.post', version: 1,
  surface: { method: 'POST', path: '/api/hr/login-access' }, exposure: 'authenticated',
  identity: { kind: 'custom', strategy: 'firebase-auth-token', guarantees: ['authenticated-user'] },
  authorization: { kind: 'custom', strategy: 'self-or-hr-manage' },
  resourceScope: { kind: 'custom', strategy: 'self-or-hr-managed-user' },
  input: { kind: 'schema', schema: 'hr.login-access-justification', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const guarantees = ['identity:firebase-auth-token', 'authenticated-user', 'authorization:self-or-hr-manage',
  'scope:self-or-hr-managed-user', 'input-validated', 'fields-allowlisted'] as const;
const getEnforcer = defineSecurityEnforcer({ id: 'hr-login-access-get-v1', guarantees,
  async enforce({ request }: { request: NextRequest }) {
    const decoded = await verifyAuth(request).catch(() => { throw new AppError({ code: 'HR_LOGIN_ACCESS_AUTH_REQUIRED', kind: 'AUTHENTICATION' }); });
    if (!decoded.uid) throw new AppError({ code: 'HR_LOGIN_ACCESS_AUTH_REQUIRED', kind: 'AUTHENTICATION' });
    const query = z.object({ userId: z.string().trim().min(1).max(180).optional(),
      at: z.string().max(80).optional(), timeZone: z.string().max(80).optional() }).strict()
      .safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) throw new AppError({ code: 'HR_LOGIN_ACCESS_QUERY_INVALID', kind: 'VALIDATION' });
    const targetUserId = query.data.userId || decoded.uid;
    if (targetUserId !== decoded.uid) await assertHrAccess(request, 'manage');
    return { actor: decoded, input: query.data, resource: { targetUserId } };
  },
});
const postEnforcer = defineSecurityEnforcer({ id: 'hr-login-access-post-v1', guarantees,
  async enforce({ request }: { request: NextRequest }) {
    const decoded = await verifyAuth(request).catch(() => { throw new AppError({ code: 'HR_LOGIN_ACCESS_AUTH_REQUIRED', kind: 'AUTHENTICATION' }); });
    if (!decoded.uid) throw new AppError({ code: 'HR_LOGIN_ACCESS_AUTH_REQUIRED', kind: 'AUTHENTICATION' });
    const input = justificationSchema.safeParse(await request.clone().json().catch(() => null));
    if (!input.success) throw new AppError({ code: 'HR_LOGIN_ACCESS_INPUT_INVALID', kind: 'VALIDATION' });
    const targetUserId = input.data.userId || decoded.uid;
    if (targetUserId !== decoded.uid) await assertHrAccess(request, 'manage');
    return { actor: decoded, input: input.data, resource: { targetUserId } };
  },
});

type LoginAccessUserPayload = {
  id: string;
  username: string;
  email: string | null;
  jobRoleId: string | null;
  jobRoleName: string | null;
  loginRestrictionEnabled: boolean;
  shiftDefinitionId: string | null;
};

type LoginAccessRolePayload = {
  id: string;
  name: string;
  loginRestricted: boolean;
} | null;

async function loadLoginAccessUser(targetUserId: string): Promise<LoginAccessUserPayload> {
  const userSnap = await dbAdmin.collection("users").doc(targetUserId).get();
  if (!userSnap.exists) {
    throw new Error("Colaborador não encontrado.");
  }

  const userData = userSnap.data() ?? {};
  return {
    id: userSnap.id,
    username: typeof userData.username === "string" ? userData.username : userSnap.id,
    email: typeof userData.email === "string" ? userData.email : null,
    jobRoleId: typeof userData.jobRoleId === "string" ? userData.jobRoleId : null,
    jobRoleName: typeof userData.jobRoleName === "string" ? userData.jobRoleName : null,
    loginRestrictionEnabled: userData.loginRestrictionEnabled === true,
    shiftDefinitionId:
      typeof userData.shiftDefinitionId === "string" ? userData.shiftDefinitionId : null,
  };
}

async function loadLoginAccessRole(
  user: LoginAccessUserPayload
): Promise<LoginAccessRolePayload> {
  if (!user.jobRoleId) {
    return null;
  }

  const roleSnap = await hrDbAdmin.collection("jobRoles").doc(user.jobRoleId).get();
  if (!roleSnap.exists) {
    return null;
  }

  const roleData = roleSnap.data() ?? {};
  return {
    id: roleSnap.id,
    name:
      typeof roleData.name === "string" && roleData.name
        ? roleData.name
        : user.jobRoleName ?? roleSnap.id,
    loginRestricted: roleData.loginRestricted === true,
  };
}

async function loadLoginAccessShifts(
  targetUserId: string,
  dates: string[]
): Promise<LoginRestrictionShiftInput[]> {
  const snapshots = await Promise.all(
    dates.map((date) =>
      dbAdmin
        .collectionGroup("shifts")
        .where("userId", "==", targetUserId)
        .where("date", "==", date)
        .limit(101).get()
    )
  );
  if (snapshots.some((snapshot) => snapshot.size === 101)) throw new Error('Há turnos demais para conferir o acesso com segurança.');
  const physical = snapshots.flatMap((snapshot) => snapshot.docs);
  const scheduleRefs = [...new Map(physical.map((doc) => [doc.ref.parent.parent!.path, doc.ref.parent.parent!] as const)).values()];
  const schedules = scheduleRefs.length ? await dbAdmin.getAll(...scheduleRefs) : [];
  const allowed = new Set(schedules.filter((schedule) => !schedule.get('activeRevisionId')
    && hasPublishedScheduleVersion(schedule.data() ?? {})).map((schedule) => schedule.ref.path));
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const indexed = (await Promise.all(months.map(async (competence) => {
    const result = await readOfficialPersonMonth({ userId: targetUserId, competence, db: dbAdmin });
    if (result.indexed) return result.shifts;
    const [year, month] = competence.split('-').map(Number);
    const schedules = await dbAdmin.collection('dp_schedules').where('year', '==', year)
      .where('month', '==', month).limit(21).get();
    if (schedules.size === 21) throw new Error('Há escalas demais para conferir o acesso com segurança.');
    const pointer = schedules.docs.filter((schedule) => schedule.get('activeRevisionId'));
    return (await Promise.all(pointer.map((schedule) => readOfficialScheduleShifts({
      scheduleId: schedule.id, userId: targetUserId, db: dbAdmin,
    })))).flatMap((item) => item.shifts);
  }))).flat();
  const effective = new Map<string, Record<string, unknown> & { id: string }>();
  physical.filter((doc) => allowed.has(doc.ref.parent.parent!.path)).forEach((doc) => effective.set(doc.ref.path,
    { id: doc.id, ...doc.data() }));
  indexed.filter((shift) => dates.includes(String(shift.date))).forEach((shift) => effective.set(
    `dp_schedules/${shift.scheduleId}/shifts/${shift.id}`, shift));
  return [...effective.values()].map((data): LoginRestrictionShiftInput => {
      return {
        id: data.id,
        scheduleId: typeof data.scheduleId === "string" ? data.scheduleId : "",
        unitId: typeof data.unitId === "string" ? data.unitId : "",
        date: typeof data.date === "string" ? data.date : "",
        startTime: typeof data.startTime === "string" ? data.startTime : "00:00",
        endTime: typeof data.endTime === "string" ? data.endTime : "00:00",
        type: data.type === "day_off" ? "day_off" : "work",
        shiftDefinitionId:
          typeof data.shiftDefinitionId === "string" ? data.shiftDefinitionId : undefined,
      };
    });
}

async function loadLoginAccessJustifications(
  targetUserId: string,
  dates: string[]
): Promise<LoginRestrictionJustificationInput[]> {
  const snapshots = await Promise.all(
    dates.map((date) =>
      dbAdmin
        .collection("dp_loginAccessJustifications")
        .where("userId", "==", targetUserId)
        .where("shiftDate", "==", date)
        .get()
    )
  );

  return snapshots.flatMap((snapshot) =>
    snapshot.docs
      .map((doc): LoginRestrictionJustificationInput | null => {
        const data = doc.data() ?? {};

        if (
          typeof data.shiftId !== "string" ||
          typeof data.shiftDate !== "string" ||
          typeof data.submittedAt !== "string" ||
          typeof data.grantedUntil !== "string" ||
          typeof data.sequence !== "number"
        ) {
          return null;
        }

        return {
          id: doc.id,
          userId: typeof data.userId === "string" ? data.userId : targetUserId,
          shiftId: data.shiftId,
          shiftDate: data.shiftDate,
          submittedAt: data.submittedAt,
          grantedUntil: data.grantedUntil,
          sequence: data.sequence,
          grantedMinutes:
            typeof data.grantedMinutes === "number"
              ? data.grantedMinutes
              : LOGIN_RESTRICTION_EXTENSION_MINUTES,
          reason: "after_shift_extension",
        };
      })
      .filter((item): item is LoginRestrictionJustificationInput => item !== null)
  );
}

async function buildLoginAccessPayload(params: {
  targetUserId: string;
  at: Date;
  timeZone: string;
}) {
  const { localDate, previousDate } = getLoginRestrictionProbeDates(
    params.at,
    params.timeZone
  );
  const user = await loadLoginAccessUser(params.targetUserId);
  const [role, shifts, justifications] = await Promise.all([
    loadLoginAccessRole(user),
    loadLoginAccessShifts(params.targetUserId, [localDate, previousDate]),
    loadLoginAccessJustifications(params.targetUserId, [localDate, previousDate]),
  ]);

  const evaluation = evaluateLoginRestriction({
    limiterEnabled: user.loginRestrictionEnabled,
    shifts,
    justifications,
    at: params.at,
    timeZone: params.timeZone,
  });

  return {
    user,
    role,
    shifts,
    justifications,
    evaluation,
  };
}

async function appendLoginAccessAudit(event: string, payload: Record<string, unknown>) {
  await logAction({
    user_id: typeof payload.actorUserId === "string" ? payload.actorUserId : null,
    module: "auth",
    action: event,
    metadata: payload,
  });
}

async function handleGET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get("userId")?.trim() || decoded.uid;
    const atParam = searchParams.get("at");
    const timeZone = searchParams.get("timeZone")?.trim() || DEFAULT_LOGIN_ACCESS_TIMEZONE;

    if (targetUserId !== decoded.uid) {
      await assertHrAccess(request, "manage");
    }

    const evaluatedAt = atParam ? new Date(atParam) : new Date();
    if (Number.isNaN(evaluatedAt.getTime())) {
      return NextResponse.json({ error: "Data de avaliação inválida." }, { status: 400 });
    }

    const payload = await buildLoginAccessPayload({
      targetUserId,
      at: evaluatedAt,
      timeZone,
    });

    return NextResponse.json({
      user: payload.user,
      role: payload.role,
      evaluation: payload.evaluation,
    });
  } catch (error) {
    const status = error instanceof Error && error.message === "Colaborador não encontrado." ? 404 : 400;
    const message = status === 404 ? "Colaborador não encontrado." : "Não foi possível avaliar o acesso por escala.";
    return NextResponse.json({ error: message }, { status });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 401 });
    }

    const body = justificationSchema.parse(await request.json());
    const targetUserId = body.userId?.trim() || decoded.uid;
    const timeZone = DEFAULT_LOGIN_ACCESS_TIMEZONE;

    if (targetUserId !== decoded.uid) {
      await assertHrAccess(request, "manage");
    }

    const evaluatedAt = new Date();
    const payload = await buildLoginAccessPayload({
      targetUserId,
      at: evaluatedAt,
      timeZone,
    });

    if (!payload.user.loginRestrictionEnabled) {
      return NextResponse.json(
        { error: "O limitador não está ativo para este colaborador." },
        { status: 400 }
      );
    }

    if (
      payload.evaluation.reason !== "after_shift_requires_justification" ||
      !payload.evaluation.referenceShift
    ) {
      return NextResponse.json(
        { error: "O acesso atual não está apto para nova justificativa." },
        { status: 409 }
      );
    }

    const sequence = payload.evaluation.extensionUsage.used + 1;
    const submittedAt = evaluatedAt.toISOString();
    const grantedUntil = new Date(
      evaluatedAt.getTime() + LOGIN_RESTRICTION_EXTENSION_MINUTES * 60 * 1000
    ).toISOString();
    const shift = payload.evaluation.referenceShift;

    const justificationData = {
      actorUserId: decoded.uid,
      userId: payload.user.id,
      usernameSnapshot: payload.user.username,
      emailSnapshot: payload.user.email,
      jobRoleId: payload.user.jobRoleId,
      jobRoleName: payload.user.jobRoleName,
      scheduleId: shift.scheduleId,
      shiftId: shift.id,
      shiftDate: shift.date,
      shiftEndDate: shift.endDate,
      shiftStartTime: shift.startTime,
      shiftEndTime: shift.endTime,
      unitId: shift.unitId,
      blockedAt: payload.evaluation.evaluatedAt,
      submittedAt,
      justificationText: body.justificationText,
      sequence,
      grantedMinutes: LOGIN_RESTRICTION_EXTENSION_MINUTES,
      grantedUntil,
      reason: "after_shift_extension" as const,
      timeZone,
      createdAt: submittedAt,
    };

    const justificationRef = await dbAdmin
      .collection("dp_loginAccessJustifications")
      .add(justificationData);

    await Promise.all([
      appendLoginAccessAudit("overtime_justification", {
        actorUserId: decoded.uid,
        targetUserId: payload.user.id,
        scheduleId: shift.scheduleId,
        shiftId: shift.id,
        justificationId: justificationRef.id,
        metadata: {
          sequence,
          grantedMinutes: LOGIN_RESTRICTION_EXTENSION_MINUTES,
        },
      }),
      appendLoginAccessAudit("login_access.extension_granted", {
        actorUserId: decoded.uid,
        targetUserId: payload.user.id,
        scheduleId: shift.scheduleId,
        shiftId: shift.id,
        justificationId: justificationRef.id,
        metadata: {
          sequence,
          grantedUntil,
        },
      }),
    ]);

    const updatedEvaluation = evaluateLoginRestriction({
      limiterEnabled: payload.user.loginRestrictionEnabled,
      shifts: payload.shifts,
      justifications: [
        ...payload.justifications,
        {
          id: justificationRef.id,
          userId: payload.user.id,
          shiftId: shift.id,
          shiftDate: shift.date,
          submittedAt,
          grantedUntil,
          sequence,
          grantedMinutes: LOGIN_RESTRICTION_EXTENSION_MINUTES,
          reason: "after_shift_extension",
        },
      ],
      at: evaluatedAt,
      timeZone,
    });

    return NextResponse.json(
      {
        user: payload.user,
        role: payload.role,
        evaluation: updatedEvaluation,
        justification: {
          id: justificationRef.id,
          ...justificationData,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: "Não foi possível registrar a justificativa." }, { status: 400 });
  }
}

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ request }) => handleGET(request));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ request }) => handlePOST(request));
