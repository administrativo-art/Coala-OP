"use client";

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotationWorkspace } from '@/components/purchasing/quotation-workspace';
import { useAuth } from '@/hooks/use-auth';
import { useQuotations } from '@/hooks/use-quotations';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type Quotation } from '@/types';

export default function QuotationPage() {
  const params = useParams<{ quotationId: string }>();
  const router = useRouter();
  const { permissions, firebaseUser } = useAuth();
  const { quotations, loading } = useQuotations();
  const canView = canViewPurchasing(permissions);
  const [fallbackQuotation, setFallbackQuotation] = useState<Quotation | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  const providerQuotation = useMemo(
    () => quotations.find((q) => q.id === params.quotationId),
    [quotations, params.quotationId],
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchQuotationFallback() {
      if (loading || providerQuotation || !firebaseUser || !params.quotationId) return;
      setFallbackLoading(true);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/purchasing/quotations/${params.quotationId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });
        if (!response.ok) {
          if (!cancelled) setFallbackQuotation(null);
          return;
        }
        const data = (await response.json()) as Quotation | null;
        if (!cancelled) setFallbackQuotation(data);
      } catch (error) {
        console.error('Error fetching quotation via API fallback:', error);
        if (!cancelled) setFallbackQuotation(null);
      } finally {
        if (!cancelled) setFallbackLoading(false);
      }
    }

    void fetchQuotationFallback();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, loading, params.quotationId, providerQuotation]);

  const quotation = providerQuotation ?? fallbackQuotation;

  if (loading || fallbackLoading) {
    return (
      <div className="container max-w-4xl py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="container max-w-4xl py-8 space-y-4">
        <p className="text-muted-foreground">Cotação não encontrada.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/purchasing')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para cotações
        </Button>
      </div>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-4xl py-8 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/dashboard/purchasing')}
        className="-ml-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Cotações
      </Button>

        <QuotationWorkspace quotation={quotation} />
      </div>
    </PermissionGuard>
  );
}
