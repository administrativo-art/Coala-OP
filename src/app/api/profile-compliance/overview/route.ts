import { NextResponse, type NextRequest } from "next/server";

import { evaluateUserProfileCompliance } from "@/features/hr/profile-compliance.server";
import type { ProfileComplianceField, ProfileComplianceStatus } from "@/features/hr/profile-compliance";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OverviewRow = {
  userId: string;
  employeeId: string | null;
  name: string;
  email: string;
  status: ProfileComplianceStatus | "unlinked";
  missingFields: Array<ProfileComplianceField | "person_link">;
  invalidFields: ProfileComplianceField[];
  lastConfirmedAt: string | null;
  nextReviewAt: string | null;
};

function iso(value: unknown) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof candidate.toDate === "function") return (candidate.toDate as () => Date)().toISOString();
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const allowed = actor.isDefaultAdmin
      || actor.permissions.settings.manageUsers === true
      || actor.permissions.dp?.collaborators?.view === true
      || actor.permissions.dp?.collaborators?.edit === true;
    if (!allowed) return NextResponse.json({ error: "Sem permissão para acompanhar cadastros." }, { status: 403 });

    const usersSnap = await dbAdmin.collection("users").get();
    const activeUsers = usersSnap.docs.filter((document) => document.get("isActive") !== false);
    const rows: OverviewRow[] = await Promise.all(activeUsers.map(async (document) => {
      const user = document.data();
      const compliance = user.profileCompliance && typeof user.profileCompliance === "object"
        ? user.profileCompliance as Record<string, unknown>
        : {};
      try {
        const current = await evaluateUserProfileCompliance(document.id);
        return {
          userId: document.id,
          employeeId: current.employeeId,
          name: String(user.username ?? user.name ?? user.email ?? "Usuário"),
          email: String(user.email ?? ""),
          status: current.status,
          missingFields: current.missingFields,
          invalidFields: current.invalidFields,
          lastConfirmedAt: iso(compliance.lastConfirmedAt),
          nextReviewAt: iso(compliance.nextReviewAt),
        };
      } catch {
        return {
          userId: document.id,
          employeeId: null,
          name: String(user.username ?? user.name ?? user.email ?? "Usuário"),
          email: String(user.email ?? ""),
          status: "unlinked",
          missingFields: ["person_link"],
          invalidFields: [],
          lastConfirmedAt: iso(compliance.lastConfirmedAt),
          nextReviewAt: iso(compliance.nextReviewAt),
        };
      }
    }));
    rows.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const fieldCounts = rows.reduce<Record<string, number>>((counts, row) => {
      for (const field of new Set([...row.missingFields, ...row.invalidFields])) {
        counts[field] = (counts[field] ?? 0) + 1;
      }
      return counts;
    }, {});
    const counts = {
      total: rows.length,
      complete: rows.filter((row) => row.status === "complete").length,
      pending: rows.filter((row) => row.status === "pending").length,
      overdue: rows.filter((row) => row.status === "overdue").length,
      unlinked: rows.filter((row) => row.status === "unlinked").length,
    };
    return NextResponse.json({ counts, fieldCounts, rows }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falha ao carregar acompanhamento cadastral.",
    }, { status: 400 });
  }
}
