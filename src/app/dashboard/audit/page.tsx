
"use client";

import { StockAuditManagement } from "@/components/stock-audit-management";

export default function AuditPage() {
    return (
        <div className="space-y-6">
            <StockAuditManagement showExportButton={true} />
        </div>
    );
}
