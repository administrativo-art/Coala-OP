import { NextRequest, NextResponse } from "next/server";

import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  assertLegacyChecklistReadAllowed,
  assertLegacyChecklistWriteAllowed,
  shouldRedirectLegacyChecklistPages,
} from "@/features/dp-checklists/lib/rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertDPChecklistAccess(request, "view");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Sem permissão para consultar rollout de checklist.",
      },
      { status: 403 }
    );
  }

  let legacyReadAllowed = true;
  let legacyWriteAllowed = true;

  try {
    await assertLegacyChecklistReadAllowed();
  } catch {
    legacyReadAllowed = false;
  }

  try {
    await assertLegacyChecklistWriteAllowed();
  } catch {
    legacyWriteAllowed = false;
  }

  const redirectPages = await shouldRedirectLegacyChecklistPages();

  return NextResponse.json({
    legacyReadAllowed,
    legacyWriteAllowed,
    redirectPages,
  });
}
