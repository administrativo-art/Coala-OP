
"use client";

import { useContext } from 'react';
import { FormContext, type FormContextType } from '@/components/form-provider';

export const useForm = (): FormContextType => {
  const context = useContext(FormContext);
  if (context === undefined) {
    throw new Error('useForm must be used within a FormProvider');
  }
  return context;
};
