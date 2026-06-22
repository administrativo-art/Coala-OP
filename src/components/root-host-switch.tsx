"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import VagasPage from "@/app/vagas/page";
import { RootSystemRedirect } from "@/components/root-system-redirect";

const PUBLIC_RECRUITMENT_HOST = "vagas.coalashakes.com";

function RootLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    </div>
  );
}

export function RootHostSwitch() {
  const [isPublicRecruitmentHost, setIsPublicRecruitmentHost] = useState<boolean | null>(null);

  useEffect(() => {
    const isPublicHost = window.location.hostname.toLowerCase() === PUBLIC_RECRUITMENT_HOST;
    setIsPublicRecruitmentHost(isPublicHost);

    if (isPublicHost) {
      document.title = "Vagas | Coala Shakes";
    }
  }, []);

  if (isPublicRecruitmentHost === null) {
    return <RootLoading />;
  }

  return isPublicRecruitmentHost ? <VagasPage /> : <RootSystemRedirect />;
}
