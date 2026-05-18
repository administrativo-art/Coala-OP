import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canViewAudit(context: Awaited<ReturnType<typeof requireUser>>) {
  return Boolean(
    context.isDefaultAdmin ||
      context.permissions.settings.manageUsers ||
      context.permissions.settings.manageProfiles
  );
}

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    const date = (value as { toDate?: () => Date }).toDate?.();
    return date ? date.toISOString() : null;
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canViewAudit(context)) {
      return NextResponse.json({ error: "Sem permissao para visualizar auditoria." }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const moduleFilter = params.get("module")?.trim().toLowerCase();
    const actionFilter = params.get("action")?.trim().toLowerCase();
    const userFilter = params.get("userId")?.trim();
    const searchFilter = params.get("search")?.trim().toLowerCase();
    const requestedLimit = Number(params.get("limit") ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 20), 200);

    const snapshot = await dbAdmin
      .collection("actionLogs")
      .orderBy("timestamp", "desc")
      .limit(500)
      .get();

    const logs = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          workspace_id: typeof data.workspace_id === "string" ? data.workspace_id : null,
          user_id: typeof data.user_id === "string" ? data.user_id : null,
          username: typeof data.username === "string" ? data.username : null,
          module: typeof data.module === "string" ? data.module : "",
          action: typeof data.action === "string" ? data.action : "",
          metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
          ip_address: typeof data.ip_address === "string" ? data.ip_address : null,
          timestamp: serializeDate(data.timestamp),
          ttl: serializeDate(data.ttl),
        };
      })
      .filter((log) => {
        if (log.workspace_id !== context.workspace_id) return false;
        if (moduleFilter && !log.module.toLowerCase().includes(moduleFilter)) return false;
        if (actionFilter && !log.action.toLowerCase().includes(actionFilter)) return false;
        if (userFilter && log.user_id !== userFilter) return false;
        if (searchFilter) {
          const haystack = [
            log.username,
            log.module,
            log.action,
            log.ip_address,
            JSON.stringify(log.metadata),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(searchFilter)) return false;
        }
        return true;
      })
      .slice(0, limit);

    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar auditoria." },
      { status: 400 }
    );
  }
}
