"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DPSettingsOrganogramPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=organogram");
  }, [router]);
  return null;
}
