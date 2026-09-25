"use client";

import { AlertTriangle } from 'lucide-react';
import { readHrJsonResponse } from '@/features/hr/lib/client-response';

export const PUBLIC_RECRUITMENT_URL = 'https://vagas.coalashakes.com';

export function candidateInitials(name?: string | null) {
  return (name ?? 'IN')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'IN';
}

// The HR endpoints have several response shapes; callers may opt into a precise type.
// Keep the legacy default for the existing call sites while centralizing safe parsing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiFetch<T = any>(path: string, getToken: () => Promise<string>, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return readHrJsonResponse<T>(res, 'Falha ao concluir a operação.');
}

export function ErrorLine({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {msg}
    </p>
  );
}
