
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StockWriteDown } from '@/components/stock-write-down';
import { ArrowLeft } from 'lucide-react';

export default function StockWriteDownPage() {
    return (
        <div className="space-y-4">
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para gestão de estoque
                </Button>
            </Link>
            <StockWriteDown />
        </div>
    );
}
