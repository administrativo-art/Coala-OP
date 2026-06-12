/**
 * Corrige o fornecedor do pedido de compra do force-venda 116.410:
 * de "C T SORVETES LTDA" (que era o CLIENTE) para o fornecedor correto
 * "Cantinho Distribuidora LTDA".
 *
 * USO: node scripts/fix-purchase-116410-supplier.mjs
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

const saPath = 'scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json';
if (!existsSync(saPath)) { console.error(`SA não encontrado: ${saPath}`); process.exit(1); }
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const app = getApps().find((a) => a.name === 'fix-purchase') ?? initializeApp({ credential: cert(sa) }, 'fix-purchase');
const db = getFirestore(app, 'coala');

const SOURCE_REF = 'forca-venda-116410';
const NEW_SUPPLIER = { id: '1nlWnCjZeNSMHQvZlWkn', name: 'Cantinho Distribuidora' };

async function main() {
  const snap = await db.collection('purchase_orders')
    .where('workspaceId', '==', 'coala')
    .where('sourceRef', '==', SOURCE_REF)
    .limit(1)
    .get();
  if (snap.empty) { console.error(`Pedido ${SOURCE_REF} não encontrado.`); process.exit(1); }

  const ref = snap.docs[0].ref;
  await ref.set({
    supplierId: NEW_SUPPLIER.id,
    supplierName: NEW_SUPPLIER.name,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  console.log(`✅ Fornecedor corrigido no pedido ${ref.id} → ${NEW_SUPPLIER.name} (${NEW_SUPPLIER.id}).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e); process.exit(1); });
