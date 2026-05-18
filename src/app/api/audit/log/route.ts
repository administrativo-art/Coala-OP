import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_METADATA_DEPTH = 3;
const MAX_STRING_LENGTH = 500;

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

function cleanValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_METADATA_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => cleanValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, entry]) => [key.slice(0, 80), cleanValue(entry, depth + 1)])
    );
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body.module !== "string" || typeof body.action !== "string") {
      return NextResponse.json({ error: "Modulo e acao sao obrigatorios." }, { status: 400 });
    }

    const metadata = cleanValue({
      ...(typeof body.metadata === "object" && body.metadata ? (body.metadata as Record<string, unknown>) : {}),
      target_type: typeof body.targetType === "string" ? body.targetType : null,
      target_id: typeof body.targetId === "string" ? body.targetId : null,
      target_name: typeof body.targetName === "string" ? body.targetName : null,
    }) as Record<string, unknown>;

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: body.module.trim().slice(0, 80),
      action: body.action.trim().slice(0, 80),
      metadata,
      ip_address: getClientIp(request),
      ttl_days: 365,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar auditoria." },
      { status: 403 }
    );
  }
}
