
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { RestockAnalysis } from '@/components/restock-analysis';

export default function RestockAnalysisPage() {
    return (
        <div>
            <Link href="/dashboard/stock/analysis" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Análises
                </Button>
            </Link>
            <RestockAnalysis />
        </div>
    );
}
