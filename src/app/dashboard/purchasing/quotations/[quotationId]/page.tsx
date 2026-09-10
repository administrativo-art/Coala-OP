"use client";

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotationWorkspace } from '@/components/purchasing/quotation-workspace';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { PurchasingPageFrame } from '@/components/purchasing/purchasing-ui';
import { useAuth } from '@/hooks/use-auth';
import { useQuotations } from '@/hooks/use-quotations';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type Quotation } from '@/types';

export default function QuotationPage() {
  const params = useParams<{ quotationId: string }>();
  const { permissions, firebaseUser } = useAuth();
  const { quotations } = useQuotations();
  const canView = canViewPurchasing(permissions);
  const [fallbackQuotation, setFallbackQuotation] = useState<Quotation | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackResolved, setFallbackResolved] = useState(false);

  const providerQuotation = useMemo(
    () => quotations.find((q) => q.id === params.quotationId),
    [quotations, params.quotationId],
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchQuotationFallback() {
      if (providerQuotation) {
        setFallbackQuotation(null);
        setFallbackLoading(false);
        setFallbackResolved(true);
        return;
      }
      if (!firebaseUser || !params.quotationId) return;

      setFallbackResolved(false);
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
        if (!cancelled) {
          setFallbackLoading(false);
          setFallbackResolved(true);
        }
      }
    }

    void fetchQuotationFallback();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, params.quotationId, providerQuotation]);

  const quotation = providerQuotation ?? fallbackQuotation;

  if (!quotation && (!fallbackResolved || fallbackLoading)) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="quotations" activeStage="quotations" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </PurchasingPageFrame>
    );
  }

  if (!quotation) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="quotations" activeStage="quotations" />
        <p className="text-muted-foreground">Cotação não encontrada.</p>
        <BackButton fallbackHref="/dashboard/purchasing/quotations" label="Voltar para cotações" />
      </PurchasingPageFrame>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="quotations" activeStage="quotations" />
        <BackButton fallbackHref="/dashboard/purchasing/quotations" label="Cotações" variant="ghost" size="sm" className="-ml-2 mb-3" />

        <QuotationWorkspace quotation={quotation} />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
