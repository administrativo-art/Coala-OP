"use client";

import { FormModule } from '@/components/form-module';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function FormsPage() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Módulo de Formulários e Processos</CardTitle>
                <CardDescription>
                    Crie, edite e gerencie formulários dinâmicos e checklists operacionais para padronizar e automatizar processos.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <FormModule />
            </CardContent>
        </Card>
    )
}
