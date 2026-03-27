"use client";

import { SalesReportProvider } from '@/components/sales-report-provider';

export default function ConsumptionAnalysisLayout({ children }: { children: React.ReactNode }) {
  return (
    <SalesReportProvider>
      {children}
    </SalesReportProvider>
  );
}
