
"use client";

import { AuditDashboard } from "@/components/audit-dashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { StockAuditManagement } from "@/components/stock-audit-management";

export default function AuditPage() {
    return (
        <div className="space-y-6">
            <StockAuditManagement showExportButton={true} />
        </div>
    );
}
