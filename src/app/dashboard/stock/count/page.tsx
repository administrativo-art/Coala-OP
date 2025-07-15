
"use client"

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StockCount } from "@/components/stock-count";
import { ArrowLeft } from "lucide-react";

export default function StockCountPage() {
    return (
        <div className="space-y-4">
            <Link href="/dashboard/stock" className="inline-block">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Gestão de Estoque
                </Button>
            </Link>
            <StockCount />
        </div>
    )
}
