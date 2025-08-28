
"use client";

import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

function InventoryControlContent() {
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 justify-between items-center">
                <Link href="/dashboard/stock">
                    <Button variant="outline">
                        <ArrowLeft className="mr-2" />
                        Voltar para gestão de estoque
                    </Button>
                </Link>
                <Link href="/dashboard/stock/transfer">
                    <Button>
                        Realizar Transferência <ArrowRight className="ml-2" />
                    </Button>
                </Link>
            </div>
            <ExpiryControl />
        </div>
    );
}

export default function InventoryControlPage() {
    return (
        <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
            <InventoryControlContent />
        </Suspense>
    );
}
