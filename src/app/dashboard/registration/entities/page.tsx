

"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EntityManagement } from '@/components/entity-management';
import { ArrowLeft } from 'lucide-react';

export default function RegistrationEntitiesPage() {
    const router = useRouter();
    return (
        <div className="space-y-4">
             <div className="flex items-center gap-4 mb-2">
                <Button 
                    onClick={() => router.push('/dashboard/registration')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para cadastros"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Pessoas e empresas</h1>
                    <p className="text-sm text-muted-foreground">Voltar para cadastros</p>
                </div>
            </div>
            <EntityManagement />
        </div>
    );
}
