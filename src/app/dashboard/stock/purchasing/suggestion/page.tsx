"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { PurchaseSuggestionList } from "@/components/purchase-suggestion-list";

export default function PurchaseSuggestionPage() {
    const router = useRouter();

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button 
                    onClick={() => router.push('/dashboard/stock/purchasing')}
                    variant="outline"
                    className="h-auto p-2"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Assistente de Compras da Matriz</h1>
                    <p className="text-muted-foreground">Sugestões de compra para o estoque central com base na demanda da rede e lead time de fornecedores.</p>
                </div>
            </div>
            <PurchaseSuggestionList />
        </div>
    );
}
