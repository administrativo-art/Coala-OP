import { NextResponse } from "next/server";
import { secureRoute } from "@/lib/security/secure-route.server";
import { contextArchiveSecurity } from "@/features/documents/central/context-archive-security.server";
import { readContextArchiveFile } from "@/features/documents/central/context-archive.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { contract, enforcer } = contextArchiveSecurity(true);
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { source, id, parent } = security.input;
  const file = await readContextArchiveFile(source, security.actor, id!, parent);
  const name = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.mimeType, "Content-Disposition": `${file.mimeType === "application/pdf" ? "inline" : "attachment"}; filename="${name}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
