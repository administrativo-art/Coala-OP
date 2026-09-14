import { NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { withApiErrorHandling } from "@/lib/observability";
import { publicBioProjection } from "@/lib/public-bio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api", operation: "get-published-bio", routeOrJob: "/api/public/bio",
}, async () => {
  const snapshot = await dbAdmin.collection("public_site_settings").doc("coala-bio").get();
  const page = publicBioProjection(snapshot.get("published"));
  return NextResponse.json({ page }, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
