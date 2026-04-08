"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, DollarSign } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function CostAnalysisPage() {
  const router = useRouter();
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.pricing.view}>
        <div className="space-y-6">
        <div className="flex items-center gap-4 mb-2">
            <Button 
                onClick={() => router.push('/dashboard/pricing')}
                variant="ghost"
                className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Voltar para gestão de preços e margens"
            >
                <ArrowLeft className="w-6 h-6" />
            </Button>
            <div>
                <h1 className="text-3xl font-bold">Ficha de custo e margem</h1>
                <p className="text-sm text-muted-foreground">Voltar para gestão de preços e margens</p>
            </div>
            </div>
        <Card>
            <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <DollarSign />
                Ficha de custo e margem
            </CardTitle>
            <CardDescription>
                Crie composições, analise o CMV e simule preços de venda para entender a lucratividade. Use a tabela abaixo para uma visão detalhada e ações.
            </CardDescription>
            </CardHeader>
            <CardContent>
            <PricingSimulator />
            </CardContent>
        </Card>
        </div>
    </PermissionGuard>
  );
}