import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { reconcileTerminatedEmployeeRetention } from "@/features/hr/documents/document-retention.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secret = process.env.DOCUMENT_RETENTION_RECONCILIATION_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(token, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const result = await reconcileTerminatedEmployeeRetention(50);
  return NextResponse.json(result);
}
