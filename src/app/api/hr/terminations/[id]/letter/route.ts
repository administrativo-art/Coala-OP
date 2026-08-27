import { NextRequest, NextResponse } from "next/server";

import { replaceTerminationLetter, terminationContext } from "@/features/hr/termination/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await terminationContext(request);
    const data = await request.formData();
    const letter = data.get("letter");
    if (!(letter instanceof File)) throw new Error("Anexe a nova carta manuscrita.");
    const process = await replaceTerminationLetter({
      context,
      id: (await params).id,
      file: letter,
      handwrittenLetterConfirmed: data.get("handwrittenConfirmed") === "true",
    });
    return NextResponse.json({ process });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao substituir a carta.";
    return NextResponse.json({ error: message }, { status: /permissão|autenticad/i.test(message) ? 403 : 400 });
  }
}
