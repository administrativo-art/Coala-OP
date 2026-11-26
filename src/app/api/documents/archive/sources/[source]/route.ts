import { NextResponse } from "next/server";
import { secureRoute } from "@/lib/security/secure-route.server";
import { contextArchiveSecurity } from "@/features/documents/central/context-archive-security.server";
import { contextArchivePage } from "@/features/documents/central/context-archive.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { contract, enforcer } = contextArchiveSecurity(false);
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { source, limit, cursor, mine, parent } = security.input;
  return NextResponse.json(await contextArchivePage(source, security.actor, limit!, cursor, mine === "true", parent), { headers: { "Cache-Control": "private, no-store" } });
});
