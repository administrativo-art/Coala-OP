import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncInterStatement } from "@/features/financial/inter-statement-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTER_RECONCILIATION_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(token, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncInterStatement());
  } catch (error) {
    console.error("[inter-statement-sync] Falha na sincronização.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sincronizar o extrato do Banco Inter." },
      { status: 500 }
    );
  }
}
