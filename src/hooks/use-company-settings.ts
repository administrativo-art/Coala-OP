
"use client";

import { useContext } from 'react';
import { CompanySettingsContext, type CompanySettingsContextType } from '@/components/company-settings-provider';

export const useCompanySettings = (): CompanySettingsContextType => {
  const context = useContext(CompanySettingsContext);
  if (context === undefined) {
    throw new Error('useCompanySettings must be used within a CompanySettingsProvider');
  }
  return context;
};
