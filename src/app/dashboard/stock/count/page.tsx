"use client"

import { BackButton } from "@/components/navigation/back-button";
import { StockSessionManagement } from "@/components/stock-session-management";


export default function StockCountPage() {
    return (
        <div className="space-y-3">
            <BackButton
              fallbackHref="/dashboard/stock"
              variant="ghost"
              iconOnly
              className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
              ariaLabel="Voltar para gestão de estoque"
            />

            <StockSessionManagement />
        </div>
    )
}
