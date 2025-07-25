
"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';

export default function AuditHubPage() {
    return (
        <div className="w-full">
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    voltar para gestão de estoque
                </Button>
            </Link>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Auditoria</h1>
                <p className="text-muted-foreground">Selecione o tipo de auditoria que deseja realizar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ShieldCheck /> Auditoria de estoque</CardTitle>
                        <CardDescription>Inicie ou continue uma auditoria de contagem de lotes de estoque em um quiosque.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/audit/stock-audit" className="w-full">
                            <Button className="w-full">
                                Acessar auditoria <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
