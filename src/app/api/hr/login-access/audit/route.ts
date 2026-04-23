import { NextRequest, NextResponse } from "next/server";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import {
  LOGIN_RESTRICTION_EXTENSION_MINUTES,
  LOGIN_RESTRICTION_MAX_EXTENSIONS,
} from "@/features/hr/lib/login-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AUDIT_LIMIT = 400;
const MAX_AUDIT_LIMIT = 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type AuditJustificationRecord = {
  id: string;
  actorUserId: string | null;
  userId: string;
  usernameSnapshot: string;
  emailSnapshot: string | null;
  jobRoleId: string | null;
  jobRoleName: string | null;
  scheduleId: string;
  shiftId: string;
  shiftDate: string;
  shiftEndDate: string;
  shiftStartTime: string;
  shiftEndTime: string;
  unitId: string;
  blockedAt: string;
  submittedAt: string;
  justificationText: string;
  sequence: number;
  grantedMinutes: number;
  grantedUntil: string;
  timeZone: string;
};

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AUDIT_LIMIT;
  }

  return Math.min(Math.trunc(parsed), MAX_AUDIT_LIMIT);
}

function parseAuditRecord(
  docId: string,
  data: Record<string, unknown>
): AuditJustificationRecord | null {
  if (
    typeof data.userId !== "string" ||
    typeof data.usernameSnapshot !== "string" ||
    typeof data.shiftId !== "string" ||
    typeof data.shiftDate !== "string" ||
    typeof data.shiftEndDate !== "string" ||
    typeof data.shiftStartTime !== "string" ||
    typeof data.shiftEndTime !== "string" ||
    typeof data.blockedAt !== "string" ||
    typeof data.submittedAt !== "string" ||
    typeof data.justificationText !== "string" ||
    typeof data.sequence !== "number" ||
    typeof data.grantedUntil !== "string"
  ) {
    return null;
  }

  return {
    id: docId,
    actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : null,
    userId: data.userId,
    usernameSnapshot: data.usernameSnapshot,
    emailSnapshot: typeof data.emailSnapshot === "string" ? data.emailSnapshot : null,
    jobRoleId: typeof data.jobRoleId === "string" ? data.jobRoleId : null,
    jobRoleName: typeof data.jobRoleName === "string" ? data.jobRoleName : null,
    scheduleId: typeof data.scheduleId === "string" ? data.scheduleId : "",
    shiftId: data.shiftId,
    shiftDate: data.shiftDate,
    shiftEndDate: data.shiftEndDate,
    shiftStartTime: data.shiftStartTime,
    shiftEndTime: data.shiftEndTime,
    unitId: typeof data.unitId === "string" ? data.unitId : "",
    blockedAt: data.blockedAt,
    submittedAt: data.submittedAt,
    justificationText: data.justificationText,
    sequence: data.sequence,
    grantedMinutes:
      typeof data.grantedMinutes === "number"
        ? data.grantedMinutes
        : LOGIN_RESTRICTION_EXTENSION_MINUTES,
    grantedUntil: data.grantedUntil,
    timeZone: typeof data.timeZone === "string" ? data.timeZone : "America/Belem",
  };
}

export async function GET(request: NextRequest) {
  try {
    await assertHrAccess(request, "manage");

    const { searchParams } = new URL(request.url);
    const today = new Date();
    const defaultFrom = new Date(today);
    defaultFrom.setDate(defaultFrom.getDate() - 30);

    const dateFrom = searchParams.get("dateFrom")?.trim() || formatDateInput(defaultFrom);
    const dateTo = searchParams.get("dateTo")?.trim() || formatDateInput(today);
    const userId = searchParams.get("userId")?.trim() || null;
    const unitParam = searchParams.get("unitId")?.trim();
    const unitId = unitParam === "__none__" ? "" : unitParam || null;
    const shiftId = searchParams.get("shiftId")?.trim() || null;
    const limit = parseLimit(searchParams.get("limit"));

    if (!ISO_DATE_PATTERN.test(dateFrom) || !ISO_DATE_PATTERN.test(dateTo)) {
      return NextResponse.json(
        { error: "As datas da auditoria devem estar no formato YYYY-MM-DD." },
        { status: 400 }
      );
    }

    if (dateFrom > dateTo) {
      return NextResponse.json(
        { error: "O período informado é inválido." },
        { status: 400 }
      );
    }

    const [justificationsSnap, unitsSnap] = await Promise.all([
      dbAdmin
        .collection("dp_loginAccessJustifications")
        .where("shiftDate", ">=", dateFrom)
        .where("shiftDate", "<=", dateTo)
        .orderBy("shiftDate", "desc")
        .limit(limit)
        .get(),
      dbAdmin.collection("dp_units").get(),
    ]);

    const unitNameById = new Map<string, string>();
    unitsSnap.docs.forEach((doc) => {
      const data = doc.data() ?? {};
      unitNameById.set(
        doc.id,
        typeof data.name === "string" && data.name.trim() ? data.name : doc.id
      );
    });

    const rawItems = justificationsSnap.docs
      .map((doc) => parseAuditRecord(doc.id, doc.data() ?? {}))
      .filter((item): item is AuditJustificationRecord => item !== null);

    const availableUnits = Array.from(
      rawItems.reduce((map, item) => {
        const key = item.unitId || "__none__";
        const current = map.get(key) ?? {
          id: item.unitId || "",
          name: item.unitId
            ? unitNameById.get(item.unitId) ?? item.unitId
            : "Sem unidade",
          count: 0,
        };
        current.count += 1;
        map.set(key, current);
        return map;
      }, new Map<string, { id: string; name: string; count: number }>())
    )
      .map(([, value]) => value)
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const filteredItems = rawItems
      .filter((item) => (userId ? item.userId === userId : true))
      .filter((item) => (unitId ? item.unitId === unitId : true))
      .filter((item) => (shiftId ? item.shiftId.includes(shiftId) : true))
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));

    const grouped = Array.from(
      filteredItems.reduce((map, item) => {
        const key = `${item.userId}::${item.shiftId}`;
        const group =
          map.get(key) ??
          {
            id: key,
            userId: item.userId,
            username: item.usernameSnapshot,
            email: item.emailSnapshot,
            jobRoleName: item.jobRoleName,
            unitId: item.unitId,
            unitName: item.unitId
              ? unitNameById.get(item.unitId) ?? item.unitId
              : "Sem unidade",
            scheduleId: item.scheduleId,
            shiftId: item.shiftId,
            shiftDate: item.shiftDate,
            shiftEndDate: item.shiftEndDate,
            shiftStartTime: item.shiftStartTime,
            shiftEndTime: item.shiftEndTime,
            items: [] as AuditJustificationRecord[],
          };

        group.items.push(item);
        map.set(key, group);
        return map;
      }, new Map<string, {
        id: string;
        userId: string;
        username: string;
        email: string | null;
        jobRoleName: string | null;
        unitId: string;
        unitName: string;
        scheduleId: string;
        shiftId: string;
        shiftDate: string;
        shiftEndDate: string;
        shiftStartTime: string;
        shiftEndTime: string;
        items: AuditJustificationRecord[];
      }>())
    )
      .map(([, group]) => {
        const items = [...group.items].sort((left, right) => left.sequence - right.sequence);
        const blockedAtFirst =
          items.reduce((min, item) => (item.blockedAt < min ? item.blockedAt : min), items[0]?.blockedAt ?? "") ||
          null;
        const lastGrantedUntil =
          items.reduce(
            (max, item) => (item.grantedUntil > max ? item.grantedUntil : max),
            items[0]?.grantedUntil ?? ""
          ) || null;
        const totalGrantedMinutes = items.reduce(
          (sum, item) => sum + item.grantedMinutes,
          0
        );

        return {
          ...group,
          items,
          extensionCount: items.length,
          totalGrantedMinutes,
          blockedAtFirst,
          lastGrantedUntil,
          limitReached: items.length >= LOGIN_RESTRICTION_MAX_EXTENSIONS,
          remainingExtensions: Math.max(
            LOGIN_RESTRICTION_MAX_EXTENSIONS - items.length,
            0
          ),
        };
      })
      .sort((left, right) => {
        if (left.shiftDate !== right.shiftDate) {
          return right.shiftDate.localeCompare(left.shiftDate);
        }

        return (
          (right.blockedAtFirst ?? right.items[0]?.submittedAt ?? "").localeCompare(
            left.blockedAtFirst ?? left.items[0]?.submittedAt ?? ""
          )
        );
      });

    const summary = {
      totalJustifications: filteredItems.length,
      totalExtensionMinutes: filteredItems.reduce(
        (sum, item) => sum + item.grantedMinutes,
        0
      ),
      uniqueUsers: new Set(filteredItems.map((item) => item.userId)).size,
      uniqueShifts: new Set(filteredItems.map((item) => item.shiftId)).size,
      limitReachedShifts: grouped.filter((group) => group.limitReached).length,
      truncated: justificationsSnap.size >= limit,
    };

    return NextResponse.json({
      filters: {
        dateFrom,
        dateTo,
        userId,
        unitId,
        shiftId,
        limit,
      },
      summary,
      availableUnits,
      groups: grouped,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar auditoria de acesso por escala.",
      },
      { status: 400 }
    );
  }
}
