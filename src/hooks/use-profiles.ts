"use client";

import { useContext } from 'react';
import { ProfilesContext, type ProfilesContextType } from '@/components/profiles-provider';

export const useProfiles = (): ProfilesContextType => {
  const context = useContext(ProfilesContext);
  if (context === undefined) {
    throw new Error('useProfiles must be used within a ProfilesProvider');
  }
  return context;
};
