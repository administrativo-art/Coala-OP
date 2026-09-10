import { NextRequest, NextResponse } from "next/server";

import {
  CARD_STATEMENT_IMPORT_PROMPT_METADATA,
  extractCardStatementImportPreview,
} from "@/features/financial/card-statement-import.server";
import {
  cardStatementImportFileHash,
  getCachedCardStatementPreview,
  prepareVersionedCardStatementPreview,
} from "@/features/financial/card-statement-import-versioning.server";
import { requireUser } from "@/lib/auth-server";
import { reportSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function errorResponse(error: string, status: number, eventId?: string) {
  return NextResponse.json({ error, ...(eventId ? { eventId } : {}) }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const canImport = actor.isDefaultAdmin || (
      actor.permissions.financial?.view === true &&
      actor.permissions.financial?.cardStatements?.view === true &&
      actor.permissions.financial?.cardStatements?.import === true
    );
    if (!canImport) return errorResponse("Sem permissão para importar faturas.", 403);

    const form = await request.formData();
    const file = form.get("file");
    const accountId = String(form.get("accountId") || "").trim();
    const accountName = String(form.get("accountName") || "").trim();
    const paymentMethodId = String(form.get("paymentMethodId") || "").trim();
    const paymentMethodLabel = String(form.get("paymentMethodLabel") || "").trim();
    const monthKey = String(form.get("monthKey") || "").trim();
    if (!(file instanceof File)) return errorResponse("Selecione a fatura em PDF ou CSV.", 400);
    if (!accountId || !paymentMethodId || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return errorResponse("Cartão ou competência da fatura inválidos.", 400);
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return errorResponse("A fatura deve ter até 15 MB.", 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileSha256 = cardStatementImportFileHash(buffer);
    const statementKey = `${accountId}:${paymentMethodId}:${monthKey}`;
    const cached = await getCachedCardStatementPreview({
      statementKey,
      fileSha256,
      promptVersion: CARD_STATEMENT_IMPORT_PROMPT_METADATA.version,
    });
    const analyzedPreview = cached ?? await extractCardStatementImportPreview({
      file: new File([buffer], file.name, { type: file.type }),
      accountId,
      paymentMethodId,
      monthKey,
    });
    const preview = await prepareVersionedCardStatementPreview({
      statementKey,
      accountId,
      accountName,
      paymentMethodId,
      paymentMethodLabel,
      monthKey,
      fileName: file.name.slice(0, 240),
      contentType: file.type || (file.name.toLocaleLowerCase("pt-BR").endsWith(".pdf") ? "application/pdf" : "text/csv"),
      buffer,
      preview: analyzedPreview,
      actorId: actor.decoded.uid,
    });
    return NextResponse.json({ preview, prompt: CARD_STATEMENT_IMPORT_PROMPT_METADATA }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Envie a fatura em PDF ou CSV." ||
      message.startsWith("O CSV não contém movimentos") ||
      message.startsWith("A fatura contém mais de 400 movimentos")
    ) return errorResponse(message, 400);
    const reference = reportSystemError({
      error,
      source: "api-financial",
      operation: "preview-card-statement-import",
      routeOrJob: "/api/financial/card-statements/import-preview",
    });
    return errorResponse("Não foi possível analisar e arquivar a fatura.", 500, reference.eventId);
  }
}
