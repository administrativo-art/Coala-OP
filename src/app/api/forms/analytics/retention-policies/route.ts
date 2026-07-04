import { type NextRequest, NextResponse } from "next/server";

import { requireAnalyticsContext } from "@/features/forms/analytics/api";
import {
  createRetentionPolicy,
  listRetentionPolicies,
  retentionPolicyErrorResponse,
} from "@/features/forms/analytics/retention-policy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "manage_retention_policy"
    );
    const policies = await listRetentionPolicies({
      db: context.db,
      workspaceId: context.workspaceId,
    });
    return NextResponse.json({ policies });
  } catch (error) {
    return retentionPolicyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "manage_retention_policy"
    );
    const id = await createRetentionPolicy(
      {
        db: context.db,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      await request.json()
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return retentionPolicyErrorResponse(error);
  }
}
