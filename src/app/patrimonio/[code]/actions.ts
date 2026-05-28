'use server';

import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';

export async function createRetiradaMovement(
  assetId: string,
  assetCode: string,
  assetName: string,
  fromKioskId: string | undefined,
  fromKioskName: string | undefined,
  data: {
    withdrawerName: string;
    withdrawerUserId?: string;
    destinationName: string;
    destinationKioskId?: string;
    notes?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!data.withdrawerName.trim() || !data.destinationName.trim()) {
      return { success: false, error: 'Preencha todos os campos obrigatórios.' };
    }

    await dbAdmin.collection('assetMovements').add({
      assetId,
      assetCode,
      assetName,
      type: 'RETIRADA',
      userId: data.withdrawerUserId ?? 'externo',
      username: data.withdrawerName.trim(),
      fromKioskId: fromKioskId ?? null,
      fromKioskName: fromKioskName ?? null,
      toKioskId: data.destinationKioskId ?? null,
      toKioskName: data.destinationName.trim(),
      notes: data.notes?.trim() || null,
      occurredAt: new Date().toISOString(),
      workspaceId: WORKSPACE_ID,
    });

    return { success: true };
  } catch {
    return { success: false, error: 'Erro ao registrar movimentação.' };
  }
}
