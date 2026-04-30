"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DPSettingsRolesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=roles");
  }, [router]);
  return null;
}
