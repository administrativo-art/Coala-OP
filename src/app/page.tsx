import { headers } from "next/headers";

import VagasPage from "@/app/vagas/page";
import { RootSystemRedirect } from "@/components/root-system-redirect";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase() ?? "";

  if (host === "vagas.coalashakes.com") {
    return <VagasPage />;
  }

  return <RootSystemRedirect />;
}
