import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertFormAnalyticsPermission,
  type FormAnalyticsPermission,
} from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { type PermissionSet } from "@/types";

import { TaxonomyError } from "./taxonomy-service";

export async function requireAnalyticsContext(
  request: NextRequest,
  permission: FormAnalyticsPermission
) {
  const user = await requireUser(request);
  assertFormAnalyticsPermission(
    user.permissions,
    user.isDefaultAdmin,
    permission
  );

  return {
    db: checklistDbAdmin,
    workspaceId: user.workspace_id,
    userId: user.userDoc.id,
    username: user.userDoc.username,
    permissions: user.permissions,
    isDefaultAdmin: user.isDefaultAdmin,
  };
}

export function assertAnalyticsContextPermission(
  context: { permissions: PermissionSet; isDefaultAdmin: boolean },
  permission: FormAnalyticsPermission
) {
  assertFormAnalyticsPermission(
    context.permissions,
    context.isDefaultAdmin,
    permission
  );
}

export function parseActiveFilter(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("active");
  if (value === null) return undefined;
  return value.toLowerCase() === "true";
}

export function taxonomyErrorResponse(error: unknown, fallback: string) {
  if (error instanceof TaxonomyError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "in_use" || error.code === "slug_conflict"
          ? 409
          : 422;

    return NextResponse.json(
      { error: error.message, code: error.code },
      { status }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Payload inválido.", issues: error.issues },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 403 }
  );
}
