import { NextRequest, NextResponse } from "next/server";

import {
  buildCollaboratorSchedulePayload,
  canAccessCollaboratorSchedule,
} from "@/features/collaborator-schedule/server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePeriod(request: NextRequest) {
  const now = new Date();
  const year = Number(
    request.nextUrl.searchParams.get("year") ?? now.getFullYear()
  );
  const month = Number(
    request.nextUrl.searchParams.get("month") ?? now.getMonth() + 1
  );

  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > now.getFullYear() + 2 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("Período de escala inválido.");
  }

  return { year, month };
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireUser(request);
    if (!canAccessCollaboratorSchedule(access)) {
      return NextResponse.json(
        { error: "Sem permissão para acessar sua escala." },
        { status: 403 }
      );
    }

    const { year, month } = parsePeriod(request);
    return NextResponse.json(
      await buildCollaboratorSchedulePayload(access, year, month)
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao carregar sua escala.";
    const status = message === "Período de escala inválido." ? 400 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
