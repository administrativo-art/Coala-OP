import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCHES = "documentUploadBatches";
const ITEMS = "documentUploadItems";
const MAX_BATCHES_PER_RUN = 50;

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

/**
 * Fase 8 — Limpeza de lotes de importação expirados (uploads abandonados).
 * Remove os binários temporários e os documentos de lote/itens vencidos
 * (`expiresAt < agora`). Idempotente e limitado por execução. Pode ser chamado
 * por um cron autenticado ou por um admin. Não toca em documentos já arquivados
 * (que vivem em `employeeDocuments`, fora do temporário).
 */
export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    if (!access.isDefaultAdmin && !access.permissions.settings?.manageUsers) {
      return error("Apenas administradores podem executar a limpeza.", 403);
    }

    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const now = Timestamp.now();
    const expired = await hrDbAdmin.collection(BATCHES)
      .where("expiresAt", "<", now)
      .limit(MAX_BATCHES_PER_RUN)
      .get();

    let removedBatches = 0;
    let removedItems = 0;

    for (const batchDoc of expired.docs) {
      const batchId = batchDoc.id;

      // Remove todos os binários temporários do lote (prefixo).
      await bucket.deleteFiles({ prefix: `hr/pending-document-batches/${batchId}/` }).catch(() => {});

      // Remove os itens do lote (em blocos).
      const items = await hrDbAdmin.collection(ITEMS).where("batchId", "==", batchId).get();
      for (const itemDoc of items.docs) {
        // Inclui a subcoleção de auditoria: deletar apenas o documento pai a
        // deixaria eventos órfãos, invisíveis na interface e ainda retidos.
        await hrDbAdmin.recursiveDelete(itemDoc.ref).catch(() => {});
        removedItems += 1;
      }

      await batchDoc.ref.delete().catch(() => {});
      removedBatches += 1;
    }

    return NextResponse.json({ removedBatches, removedItems, scanned: expired.size });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha na limpeza.", 403);
  }
}
