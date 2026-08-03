import { NextRequest, NextResponse } from "next/server";
import { getTerminationByAccountantToken, uploadAccountantDocuments } from "@/features/hr/termination/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no portal." }, { status: 400 }); }

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const process = await getTerminationByAccountantToken((await params).token);
    return NextResponse.json({
      process: {
        employeeName: process.employeeName,
        protocol: process.request.protocol,
        unitName: process.unitName,
        jobRoleName: process.jobRoleName,
        notice: process.notice,
        status: process.accountant?.status ?? "not_started",
        correctionMessage: process.accountant?.correctionMessage ?? null,
        grossAmount: process.accountant?.grossAmount ?? null,
        discountAmount: process.accountant?.discountAmount ?? null,
        netAmount: process.accountant?.netAmount ?? null,
        noPaymentDue: process.accountant?.noPaymentDue ?? false,
        paymentDueDate: process.accountant?.paymentDueDate ?? process.notice?.legalPaymentDueDate ?? null,
        documents: process.documents
          .filter((document) => document.type === "accountant_document" && document.isCurrent !== false)
          .map((document) => ({ id: document.id, label: document.label, kind: document.documentKind, version: document.version ?? 1, auditStatus: document.auditStatus, correctionReason: document.correctionReason ?? null })),
      },
    });
  } catch (cause) { return error(cause); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const data = await request.formData();
    const files = [
      ...data.getAll("trct").filter((value): value is File => value instanceof File && value.size > 0).map((file) => ({ file, kind: "trct" as const })),
      ...data.getAll("calculationStatement").filter((value): value is File => value instanceof File && value.size > 0).map((file) => ({ file, kind: "calculation_statement" as const })),
      ...data.getAll("other").filter((value): value is File => value instanceof File && value.size > 0).map((file) => ({ file, kind: "other" as const })),
    ];
    const numeric = (name: string) => {
      const value = String(data.get(name) ?? "").replace(",", ".").trim();
      return value ? Number(value) : null;
    };
    await uploadAccountantDocuments({
      token: (await params).token,
      files,
      grossAmount: numeric("grossAmount"),
      discountAmount: numeric("discountAmount"),
      netAmount: numeric("netAmount"),
      noPaymentDue: data.get("noPaymentDue") === "true",
      paymentDueDate: String(data.get("paymentDueDate") ?? "").trim() || null,
    });
    return NextResponse.json({ ok: true });
  } catch (cause) { return error(cause); }
}
