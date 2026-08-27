import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { normalizeDocumentVisibilityConfig } from "@/lib/hr/employee-document-access";
import type { DocumentVisibilityConfig, NormalizedFieldVisibility } from "@/types/rh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISIBILITIES = new Set<NormalizedFieldVisibility>(["public", "restricted_partial", "restricted_total", "confidential"]);

function cleanMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, visibility]) => key.trim() && VISIBILITIES.has(visibility as NormalizedFieldVisibility))
      .map(([key, visibility]) => [key.trim(), visibility as NormalizedFieldVisibility]),
  );
}

export async function GET(request: NextRequest) {
  try {
    await assertHrAccess(request, "manage");
    const snap = await hrDbAdmin.collection("schema").doc("field_map").get();
    return NextResponse.json({
      documentVisibility: normalizeDocumentVisibilityConfig(snap.get("document_visibility") as DocumentVisibilityConfig | undefined),
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Falha ao carregar visibilidade." }, { status: 403 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const body = await request.json().catch(() => ({}));
    const documentVisibility = normalizeDocumentVisibilityConfig({
      version: "coala-rh-documents-v1",
      categories: cleanMap(body?.categories),
      document_types: cleanMap(body?.document_types),
    });
    const now = Timestamp.now();
    const ref = hrDbAdmin.collection("schema").doc("field_map");
    await ref.set({ document_visibility: documentVisibility, updated_at: now, updated_by: access.decoded.uid }, { merge: true });
    await ref.collection("audit").add({
      action: "DOCUMENT_VISIBILITY_UPDATED",
      actorId: access.decoded.uid,
      actorName: access.actorName,
      documentVisibility,
      at: now,
    });
    return NextResponse.json({ ok: true, documentVisibility });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Falha ao salvar visibilidade." }, { status: 403 });
  }
}
