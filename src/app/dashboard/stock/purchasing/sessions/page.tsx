"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// This page now redirects to the main purchasing hub.
export default function PurchaseSessionsPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/dashboard/stock/purchasing');
    }, [router]);

    return (
        <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
    );
}
