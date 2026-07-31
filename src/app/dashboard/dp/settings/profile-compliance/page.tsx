"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DPSettingsProfileCompliancePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=profile-compliance");
  }, [router]);
  return null;
}
