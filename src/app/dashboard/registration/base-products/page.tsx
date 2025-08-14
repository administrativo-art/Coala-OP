
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BaseProductManagement } from '@/components/base-product-management';
import { ArrowLeft } from 'lucide-react';

export default function RegistrationBaseProductsPage() {
    return (
        <div>
            <Link href="/dashboard/registration" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para cadastros
                </Button>
            </Link>
            <BaseProductManagement />
        </div>
    );
}
