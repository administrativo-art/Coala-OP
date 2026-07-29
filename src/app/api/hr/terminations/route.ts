import { NextRequest, NextResponse } from "next/server";

import {
  createEmployeeResignationRequest,
  createManagedTermination,
  listTerminations,
  terminationContext,
} from "@/features/hr/termination/server";
import { managedTerminationCreateSchema } from "@/features/hr/termination/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Não foi possível processar a solicitação.";
  const status = /permissão|autenticad/i.test(message) ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const context = await terminationContext(request);
    const scope = request.nextUrl.searchParams.get("scope") === "mine" ? "mine" : "all";
    return NextResponse.json({ processes: await listTerminations(context, scope) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await terminationContext(request);
    if (request.headers.get("content-type")?.includes("application/json")) {
      const input = managedTerminationCreateSchema.parse(await request.json());
      const result = await createManagedTermination({ context, input });
      return NextResponse.json(result, { status: result.reused ? 200 : 201 });
    }
    const data = await request.formData();
    const file = data.get("letter");
    if (!(file instanceof File)) throw new Error("Anexe a carta assinada.");
    const preference = data.get("noticePreference") === "work" ? "work" : "request_waiver";
    const result = await createEmployeeResignationRequest({
      context,
      file,
      noticePreference: preference,
      desiredLastDay: typeof data.get("desiredLastDay") === "string" ? String(data.get("desiredLastDay")) || null : null,
      notes: typeof data.get("notes") === "string" ? String(data.get("notes")) || null : null,
      appBaseUrl: request.nextUrl.origin,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
