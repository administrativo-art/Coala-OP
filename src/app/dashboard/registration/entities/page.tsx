

"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EntityManagement } from '@/components/entity-management';
import { ArrowLeft } from 'lucide-react';

export default function RegistrationEntitiesPage() {
    return (
        <div>
            <Link href="/dashboard/registration" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para cadastros
                </Button>
            </Link>
            <EntityManagement />
        </div>
    );
}
