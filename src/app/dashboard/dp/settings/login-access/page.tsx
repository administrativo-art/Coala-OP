"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DPSettingsLoginAccessPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=login-access");
  }, [router]);
  return null;
}
