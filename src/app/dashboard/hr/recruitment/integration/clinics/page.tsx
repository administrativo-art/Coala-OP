"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AsoClinicsManagement } from "@/features/hr/aso/aso-clinics-management";
import { Button } from "@/components/ui/button";

export default function AsoClinicsPage() {
  return (
    <div className="space-y-6">
      <Button variant="outline" asChild><Link href="/dashboard/hr/recruitment/integration"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar para a integração</Link></Button>
      <AsoClinicsManagement />
    </div>
  );
}
