import { NextRequest, NextResponse } from "next/server";

import {
  CARD_STATEMENT_IMPORT_PROMPT_METADATA,
  extractCardStatementImportPreview,
} from "@/features/financial/card-statement-import.server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const canImport = actor.isDefaultAdmin || (
      actor.permissions.financial?.view === true &&
      actor.permissions.financial?.cardStatements?.view === true &&
      actor.permissions.financial?.cardStatements?.import === true
    );
    if (!canImport) return NextResponse.json({ error: "Sem permissão para importar faturas." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    const accountId = String(form.get("accountId") || "").trim();
    const paymentMethodId = String(form.get("paymentMethodId") || "").trim();
    const monthKey = String(form.get("monthKey") || "").trim();
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecione a fatura em PDF ou CSV." }, { status: 400 });
    if (!accountId || !paymentMethodId || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return NextResponse.json({ error: "Cartão ou competência da fatura inválidos." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "A fatura deve ter até 15 MB." }, { status: 400 });
    }
    const preview = await extractCardStatementImportPreview({ file, accountId, paymentMethodId, monthKey });
    return NextResponse.json({ preview, prompt: CARD_STATEMENT_IMPORT_PROMPT_METADATA }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível ler a fatura." }, { status: 400 });
  }
}
