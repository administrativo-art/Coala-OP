"use client";

import { useContext } from 'react';
import { ChannelsContext, type ChannelsContextType } from '@/components/channels-provider';

export function useChannels(): ChannelsContextType {
  const context = useContext(ChannelsContext);
  if (!context) {
    throw new Error('useChannels must be used within a ChannelsProvider');
  }
  return context;
}
