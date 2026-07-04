import { type NextRequest, NextResponse } from "next/server";

import { requireAnalyticsContext } from "@/features/forms/analytics/api";
import {
  retentionPolicyErrorResponse,
  updateRetentionPolicy,
} from "@/features/forms/analytics/retention-policy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ policyId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "manage_retention_policy"
    );
    const { policyId } = await contextArg.params;
    await updateRetentionPolicy(
      {
        db: context.db,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      policyId,
      await request.json()
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return retentionPolicyErrorResponse(error);
  }
}
