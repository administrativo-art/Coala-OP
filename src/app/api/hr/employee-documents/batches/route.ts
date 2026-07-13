import { NextRequest, NextResponse } from "next/server";

import { assertHrAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";
const RESUMABLE_STATUSES = new Set(["AWAITING_REVIEW", "PARTIALLY_FILED", "ANALYZING"]);

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function obj(value: unknown): Record<string, unknown> {
  const s = serializeHrValue(value);
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
}

export async function GET(request: NextRequest) {
  try {
    await assertHrAccess(request, "manage");
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();
    if (!employeeId) return error("Colaborador não informado.");

    const batches = await hrDbAdmin.collection(BATCHES).where("employeeId", "==", employeeId).get();
    const resumable = batches.docs
      .filter((batch) => RESUMABLE_STATUSES.has(String(batch.get("status"))))
      .sort((a, b) => Number(b.get("createdAt")?.toMillis?.() ?? 0) - Number(a.get("createdAt")?.toMillis?.() ?? 0));
    const result = await Promise.all(resumable.map(async (batch) => {
      const items = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batch.id).get();
      return {
        id: batch.id,
        ...obj(batch.data()),
        items: items.docs.map((item) => ({ itemId: item.id, clientFileId: item.id, ...obj(item.data()) })),
      };
    }));
    return NextResponse.json({ batches: result });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao listar lotes pendentes.", 403);
  }
}
