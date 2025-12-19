
"use client";

import { StockCountManagement } from "@/components/stock-count-management";

export default function AuditPage() {
    return (
        <div className="space-y-6">
            <StockCountManagement showExportButton={true} />
        </div>
    );
}
