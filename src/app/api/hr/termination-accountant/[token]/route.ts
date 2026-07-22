import { NextRequest, NextResponse } from "next/server";
import { getTerminationByAccountantToken, uploadAccountantDocuments } from "@/features/hr/termination/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no portal." }, { status: 400 }); }

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const process = await getTerminationByAccountantToken((await params).token);
    return NextResponse.json({ process: { employeeName: process.employeeName, protocol: process.request.protocol, unitName: process.unitName, jobRoleName: process.jobRoleName, notice: process.notice, documentCount: process.documents.filter((doc) => doc.type === "accountant_document").length } });
  } catch (cause) { return error(cause); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const data = await request.formData();
    const files = data.getAll("files").filter((value): value is File => value instanceof File);
    await uploadAccountantDocuments({ token: (await params).token, files });
    return NextResponse.json({ ok: true });
  } catch (cause) { return error(cause); }
}
