
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConsumptionProjection } from '@/components/consumption-projection';
import { ArrowLeft } from 'lucide-react';

export default function ConsumptionProjectionPage() {
    return (
        <div>
            <Link href="/dashboard/stock/analysis" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para análises
                </Button>
            </Link>
            <ConsumptionProjection />
        </div>
    );
}
