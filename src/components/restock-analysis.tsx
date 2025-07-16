
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';

export function RestockAnalysis() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Análise de Reposição</CardTitle>
                <CardDescription>
                    Selecione um quiosque para ver as necessidades de reposição de estoque.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <Skeleton className="h-10 w-full max-w-sm" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </CardContent>
        </Card>
    );
}
