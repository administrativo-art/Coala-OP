"use client";
import Link from 'next/link';
import { GoalsAnalysisDashboard } from '@/components/goals-analysis-dashboard';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { History } from 'lucide-react';

export default function GoalsAnalysisPage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div className="space-y-4">
        <div className="flex items-start justify-between mb-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">Análise de Metas</h1>
            <p className="text-sm text-muted-foreground">Histórico e comparativos de períodos encerrados.</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/goals/history">
              <History className="mr-2 h-4 w-4" />
              Ver Histórico
            </Link>
          </Button>
        </div>
        <GoalsAnalysisDashboard />
      </div>
    </PermissionGuard>
  );
}
