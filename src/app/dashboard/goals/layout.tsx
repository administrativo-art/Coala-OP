"use client";

import { GoalsProvider } from '@/components/goals-provider';

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GoalsProvider>
      <div className="space-y-6">{children}</div>
    </GoalsProvider>
  );
}
