"use client"

import { BackButton } from "@/components/navigation/back-button";
import { useAuth } from "@/hooks/use-auth";
import { useItemAddition } from "@/hooks/use-item-addition";
import { useMemo } from "react";
import { StockSessionManagement } from "@/components/stock-session-management";


export default function StockCountPage() {
    const { permissions } = useAuth();
    const { requests, loading } = useItemAddition();

    const pendingRequestsCount = useMemo(() => {
        if (loading) return 0;
        return requests.filter(r => r.status === 'pending').length;
    }, [requests, loading]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
              <BackButton
                fallbackHref="/dashboard/stock"
                variant="ghost"
                iconOnly
                className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                ariaLabel="Voltar para gestão de estoque"
              />

              <div>
                <h1 className="text-3xl font-bold">Contagem de estoque</h1>
                <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
              </div>
            </div>
            
            <div className="mt-4">
                <StockSessionManagement />
            </div>
        </div>
    )
}
