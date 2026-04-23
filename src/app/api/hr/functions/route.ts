import { NextRequest, NextResponse } from "next/server";

import {
  jobFunctionCreateSchema,
  normalizeJobFunctionInput,
  stripUndefined,
} from "@/features/hr/lib/schemas";
import {
  assertHrAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertHrAccess(request, "view");
    const snapshot = await hrDbAdmin
      .collection("jobFunctions")
      .orderBy("name")
      .get();

    return NextResponse.json({
      functions: snapshot.docs.map((doc) => ({
        id: doc.id,
        ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar funções.",
      },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertHrAccess(request, "manage");
    const payload = normalizeJobFunctionInput(
      jobFunctionCreateSchema.parse(await request.json())
    );
    const now = new Date().toISOString();
    const data = stripUndefined({
      ...payload,
      createdAt: now,
      updatedAt: now,
    });

    const ref = await hrDbAdmin.collection("jobFunctions").add(data);
    const saved = await ref.get();

    return NextResponse.json(
      {
        function: {
          id: saved.id,
          ...((serializeHrValue(saved.data() ?? data) as Record<string, unknown>) ??
            {}),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao criar função.",
      },
      { status: 400 }
    );
  }
}
