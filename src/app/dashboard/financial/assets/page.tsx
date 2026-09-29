"use client";

import { AssetManagement } from '@/components/asset-management';
import { PageContainer } from '@/components/layout/page-container';

export default function FinancialAssetsPage() {
  return (
    <PageContainer variant="wide" surface className="space-y-6 pb-10">
      <AssetManagement />
    </PageContainer>
  );
}
