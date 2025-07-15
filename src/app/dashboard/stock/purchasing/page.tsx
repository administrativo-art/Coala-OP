
"use client";

import { PurchaseManagement } from "@/components/purchase-management";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";


export default function StockPurchasingPage() {
    return (
        <div>
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Gestão de Estoque
                </Button>
            </Link>
            <PurchaseManagement />
        </div>
    );
}
