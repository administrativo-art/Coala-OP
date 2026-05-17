import { NextRequest, NextResponse } from "next/server";

import {
  jobDepartmentCreateSchema,
  normalizeJobDepartmentInput,
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
      .collection("jobDepartments")
      .orderBy("name")
      .get();

    return NextResponse.json({
      departments: snapshot.docs.map((doc) => ({
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
            : "Erro ao carregar departamentos.",
      },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertHrAccess(request, "manage");
    const payload = normalizeJobDepartmentInput(
      jobDepartmentCreateSchema.parse(await request.json())
    );
    const now = new Date().toISOString();
    const data = stripUndefined({
      ...payload,
      createdAt: now,
      updatedAt: now,
    });

    const ref = await hrDbAdmin.collection("jobDepartments").add(data);
    const saved = await ref.get();

    return NextResponse.json(
      {
        department: {
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
          error instanceof Error
            ? error.message
            : "Erro ao criar departamento.",
      },
      { status: 400 }
    );
  }
}
