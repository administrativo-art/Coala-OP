import { useContext } from 'react';
import { QuotationContext, type QuotationContextType } from '@/components/quotation-provider';

export const useQuotations = (): QuotationContextType => {
  const ctx = useContext(QuotationContext);
  if (!ctx) throw new Error('useQuotations must be used within a QuotationProvider');
  return ctx;
};
