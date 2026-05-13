

"use client";

import { BackButton } from '@/components/navigation/back-button';
import { EntityManagement } from '@/components/entity-management';

export default function RegistrationEntitiesPage() {
    return (
        <div className="space-y-4">
             <div className="flex items-center gap-4 mb-2">
                <BackButton
                    fallbackHref="/dashboard/settings?department=operacional&tab=cadastros"
                    variant="ghost"
                    iconOnly
                    className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                    ariaLabel="Voltar para configurações"
                />
                <div>
                    <h1 className="text-3xl font-bold">Pessoas e empresas</h1>
                    <p className="text-sm text-muted-foreground">Voltar para configurações</p>
                </div>
            </div>
            <EntityManagement />
        </div>
    );
}
