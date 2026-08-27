
"use client";

import { RestockAnalysis } from '@/components/restock-analysis';
import { BackButton } from '@/components/navigation/back-button';

export default function RestockAnalysisPage() {
    return (
        <div>
            <BackButton fallbackHref="/dashboard/stock/analysis" label="Voltar para Análises" className="mb-4" />
            <RestockAnalysis />
        </div>
    );
}
