import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { attachExpenseBoleto } from "@/features/financial/payment-requests/expense-boleto.server";
import {
  expenseBoletoAttachmentId,
  expenseBoletoSchema,
  type ExpenseBoletoInput,
} from "@/features/financial/payment-requests/expense-boleto";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ expenseId: string }> };
type ExpenseResource = { expenseId: string };
type AttachInput = { data: ExpenseBoletoInput; file: File };
type DownloadInput = { installmentNumber?: number };

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const installmentSchema = z.coerce.number().int().positive().max(1000);

async function boletoActor(request: NextRequest, edit: boolean) {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "BOLETO_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.expenses?.view
    || (edit && !actor.permissions.financial?.expenses?.edit)
  )) throw new AppError({ code: "BOLETO_FORBIDDEN", kind: "AUTHORIZATION" });
  return actor;
}

async function expenseResource(context: Context, actor: ServerUserContext) {
  const expenseId = idSchema.safeParse((await context.params).expenseId);
  if (!expenseId.success) throw new AppError({ code: "BOLETO_EXPENSE_INVALID", kind: "VALIDATION", safeMessage: "Despesa inválida." });
  const expense = await financialDbAdmin.collection("expenses").doc(expenseId.data).get();
  if (!expense.exists) throw new AppError({ code: "BOLETO_EXPENSE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Despesa não encontrada." });
  if (expense.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "BOLETO_EXPENSE_FORBIDDEN", kind: "AUTHORIZATION" });
  return { expenseId: expenseId.data };
}

const attachContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.expense-boleto.attach",
  version: 1,
  surface: { method: "POST", path: "/api/financial/expenses/[expenseId]/boleto" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "expense-boleto-edit" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "expense-boleto-multipart", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const attachEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, AttachInput, ExpenseResource>({
  id: "expense-boleto-attach-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:expense-boleto-edit", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await boletoActor(request, true);
    const resource = await expenseResource(routeContext, actor);
    if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) {
      throw new AppError({ code: "BOLETO_TOO_LARGE", kind: "VALIDATION", safeMessage: "Envie um PDF de até 10 MB." });
    }
    const form = await request.formData();
    const allowedFields = new Set(["file", "installmentNumber", "barcode", "amountCents", "dueDate", "competenceMonth", "beneficiaryDocument", "documentReference", "confirmed"]);
    if ([...form.keys()].some((key) => !allowedFields.has(key))) {
      throw new AppError({ code: "BOLETO_UNKNOWN_FIELD", kind: "VALIDATION", safeMessage: "O formulário do boleto contém campo não permitido." });
    }
    const parsed = expenseBoletoSchema.safeParse({
      ...(form.get("installmentNumber") ? { installmentNumber: form.get("installmentNumber") } : {}),
      barcode: form.get("barcode"),
      amountCents: form.get("amountCents"),
      dueDate: form.get("dueDate"),
      competenceMonth: form.get("competenceMonth"),
      beneficiaryDocument: form.get("beneficiaryDocument"),
      documentReference: form.get("documentReference"),
      confirmed: form.get("confirmed") === "true",
    });
    const file = form.get("file");
    if (!parsed.success || !(file instanceof File) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new AppError({ code: "BOLETO_INVALID", kind: "VALIDATION", safeMessage: "Envie o PDF e confira todos os dados do boleto." });
    }
    return { actor, input: { data: parsed.data, file }, resource };
  },
});

export const POST = secureRoute({ contract: attachContract, enforcer: attachEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await attachExpenseBoleto(
    resource.expenseId,
    actor.workspace_id,
    input.data,
    Buffer.from(await input.file.arrayBuffer()),
    input.file.name,
    { uid: actor.decoded.uid, email: actor.decoded.email },
  );
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

const downloadContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.expense-boleto.download",
  version: 1,
  surface: { method: "GET", path: "/api/financial/expenses/[expenseId]/boleto" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "expense-boleto-view" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "expense-boleto-query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const downloadEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, DownloadInput, ExpenseResource>({
  id: "expense-boleto-download-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:expense-boleto-view", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await boletoActor(request, false);
    const resource = await expenseResource(routeContext, actor);
    const raw = request.nextUrl.searchParams.get("installmentNumber");
    const parsed = raw == null ? undefined : installmentSchema.safeParse(raw);
    if (parsed && !parsed.success) throw new AppError({ code: "BOLETO_INVALID", kind: "VALIDATION", safeMessage: "Parcela inválida." });
    if ([...request.nextUrl.searchParams.keys()].some((key) => key !== "installmentNumber")) {
      throw new AppError({ code: "BOLETO_QUERY_UNKNOWN", kind: "VALIDATION", safeMessage: "Consulta inválida." });
    }
    return { actor, input: { installmentNumber: parsed?.data }, resource };
  },
});

export const GET = secureRoute({ contract: downloadContract, enforcer: downloadEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const stored = await financialDbAdmin.collection("expenseBoletoAttachments")
    .doc(expenseBoletoAttachmentId(resource.expenseId, input.installmentNumber)).get();
  const attachment = stored.data();
  if (attachment?.workspaceId !== actor.workspace_id || !attachment?.sha256 || !/^[a-f0-9]{64}$/.test(attachment.sha256)) {
    throw new AppError({ code: "BOLETO_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Boleto não encontrado." });
  }
  const versionedPath = `financial/expense-boletos/${actor.workspace_id}/${resource.expenseId}/${input.installmentNumber ?? "single"}/${attachment.sha256}.pdf`;
  const legacyPath = `financial/expense-boletos/${actor.workspace_id}/${resource.expenseId}/${attachment.sha256}.pdf`;
  const path = input.installmentNumber == null && attachment.storagePath === legacyPath ? legacyPath : versionedPath;
  const [bytes] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"boleto.pdf\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
