import { NextRequest, NextResponse } from "next/server";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "employeeDocuments";
const VALID_STATUSES = ["pending", "received", "validated", "rejected", "expired"] as const;

type DocumentStatus = (typeof VALID_STATUSES)[number];

type EmployeeDocumentSummary = {
  employeeId: string;
  total: number;
  pending: number;
  received: number;
  validated: number;
  rejected: number;
  expired: number;
  confidential: number;
  candidateLinked: number;
  lastUploadedAt: string | null;
  categories: Record<string, number>;
};

function emptySummary(employeeId: string): EmployeeDocumentSummary {
  return {
    employeeId,
    total: 0,
    pending: 0,
    received: 0,
    validated: 0,
    rejected: 0,
    expired: 0,
    confidential: 0,
    candidateLinked: 0,
    lastUploadedAt: null,
    categories: {},
  };
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;

  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");
    const ownProfileOnly = access.permissions.dp?.collaborators?.ownProfileOnly === true;
    const ownEmployeeId = access.userDoc.id;

    const snap = await hrDbAdmin.collection(COLLECTION).get();
    const summaries = new Map<string, EmployeeDocumentSummary>();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.deletedAt) continue;

      const employeeId = typeof data.employeeId === "string" ? data.employeeId.trim() : "";
      if (!employeeId) continue;
      if (ownProfileOnly && employeeId !== ownEmployeeId) continue;

      const summary = summaries.get(employeeId) ?? emptySummary(employeeId);
      const status = VALID_STATUSES.includes(data.status) ? data.status as DocumentStatus : "received";
      const category = typeof data.category === "string" && data.category ? data.category : "pending_classification";
      const uploadedAt = timestampToIso(data.uploadedAt);

      summary.total += 1;
      summary[status] += 1;
      summary.categories[category] = (summary.categories[category] ?? 0) + 1;

      if (data.accessLevel === "confidential") summary.confidential += 1;
      if (typeof data.candidateId === "string" && data.candidateId.trim()) summary.candidateLinked += 1;
      if (uploadedAt && (!summary.lastUploadedAt || uploadedAt > summary.lastUploadedAt)) {
        summary.lastUploadedAt = uploadedAt;
      }

      summaries.set(employeeId, summary);
    }

    return NextResponse.json({ summaries: Array.from(summaries.values()) });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao carregar resumo de documentos." },
      { status: 403 }
    );
  }
}
