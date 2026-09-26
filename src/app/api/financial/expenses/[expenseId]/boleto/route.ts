import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "firebase-admin/storage";
import { requireUser } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { expenseBoletoSchema } from "@/features/financial/payment-requests/expense-boleto";
import { attachExpenseBoleto } from "@/features/financial/payment-requests/expense-boleto.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ expenseId: string }> };
const meta = { source: "api-financial", operation: "expense-boleto", routeOrJob: "/api/financial/expenses/[expenseId]/boleto" };
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
async function actorFor(request: NextRequest, edit: boolean) {
  const actor = await requireUser(request).catch(cause => { throw new AppError({ code: "BOLETO_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); });
  if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.expenses?.view || (edit && !actor.permissions.financial?.expenses?.edit))) throw new AppError({ code: "BOLETO_FORBIDDEN", kind: "AUTHORIZATION" });
  return actor;
}
export const POST = withApiErrorHandling<Context>(meta, async (request: NextRequest, context) => {
  const actor = await actorFor(request, true);
  const expenseId = idSchema.parse((await context.params).expenseId);
  if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) throw new AppError({ code: "BOLETO_TOO_LARGE", kind: "VALIDATION", safeMessage: "Envie um PDF de até 10 MB." });
  const form = await request.formData();
  const parsed = expenseBoletoSchema.safeParse({ barcode: form.get("barcode"), amountCents: form.get("amountCents"), dueDate: form.get("dueDate"), competenceMonth: form.get("competenceMonth"), beneficiaryDocument: form.get("beneficiaryDocument"), documentReference: form.get("documentReference"), confirmed: form.get("confirmed") === "true" });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File) || file.size > 10 * 1024 * 1024) throw new AppError({ code: "BOLETO_INVALID", kind: "VALIDATION", safeMessage: "Envie o PDF e confira todos os dados do boleto." });
  const result = await attachExpenseBoleto(expenseId, actor.workspace_id, parsed.data, Buffer.from(await file.arrayBuffer()), file.name, { uid: actor.decoded.uid, email: actor.decoded.email });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
export const GET = withApiErrorHandling<Context>(meta, async (request: NextRequest, context) => {
  const actor = await actorFor(request, false);
  const expenseId = idSchema.parse((await context.params).expenseId);
  const expense = await financialDbAdmin.collection("expenses").doc(expenseId).get();
  const stored = await financialDbAdmin.collection("expenseBoletoAttachments").doc(expenseId).get();
  const attachment = stored.data();
  if (!expense.exists || expense.get("workspaceId") !== actor.workspace_id || attachment?.workspaceId !== actor.workspace_id || !attachment?.sha256 || !/^[a-f0-9]{64}$/.test(attachment.sha256)) throw new AppError({ code: "BOLETO_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Boleto não encontrado." });
  // Never download an arbitrary path supplied through a client-editable expense field.
  const path = `financial/expense-boletos/${actor.workspace_id}/${expenseId}/${attachment.sha256}.pdf`;
  const [bytes] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download();
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="boleto.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
