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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const justificationSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  justificationText: z.string().trim().min(5).max(2000),
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
        .get()
    )
  );

  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((doc): LoginRestrictionShiftInput => {
      const data = doc.data() ?? {};
      return {
        id: doc.id,
        scheduleId: typeof data.scheduleId === "string" ? data.scheduleId : "",
        unitId: typeof data.unitId === "string" ? data.unitId : "",
        date: typeof data.date === "string" ? data.date : "",
        startTime: typeof data.startTime === "string" ? data.startTime : "00:00",
        endTime: typeof data.endTime === "string" ? data.endTime : "00:00",
        type: data.type === "day_off" ? "day_off" : "work",
        shiftDefinitionId:
          typeof data.shiftDefinitionId === "string" ? data.shiftDefinitionId : undefined,
      };
    })
  );
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

export async function GET(request: NextRequest) {
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
    const message =
      error instanceof Error ? error.message : "Erro ao avaliar acesso por escala.";
    const status = message === "Colaborador não encontrado." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
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
    const message =
      error instanceof Error ? error.message : "Erro ao registrar justificativa.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
