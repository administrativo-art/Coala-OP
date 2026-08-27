import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const apply = process.argv.includes("--apply");
const sourceRef = "cantinho-forca-venda-137768-pedido-140147-20260721";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (credentialPath && existsSync(credentialPath)) {
    return cert(JSON.parse(readFileSync(credentialPath, "utf8")));
  }
  return applicationDefault();
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clean(item)])
    );
  }
  return value;
}

const app =
  getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");
const duplicate = await db
  .collection("purchase_orders")
  .where("sourceRef", "==", sourceRef)
  .get();

if (!duplicate.empty) {
  console.log(
    JSON.stringify(
      {
        status: "already_exists",
        sourceRef,
        orders: duplicate.docs.map((document) => ({
          id: document.id,
          ...clean(document.data()),
        })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

const supplierId = "1nlWnCjZeNSMHQvZlWkn";
const baseItemId = "FU7qNHLXSNYGNhwVdl14";
const productId = "uJwW1CrGWHEemL51Ph9g";
const quantityOrdered = 20;
const unitPriceOrdered = 39.99;
const totalOrdered = 799.8;
const now = new Date().toISOString();

const [supplierSnapshot, baseProductSnapshot, productSnapshot] =
  await Promise.all([
    db.collection("entities").doc(supplierId).get(),
    db.collection("baseProducts").doc(baseItemId).get(),
    db.collection("products").doc(productId).get(),
  ]);

if (!supplierSnapshot.exists) throw new Error("Fornecedor não encontrado.");
if (!baseProductSnapshot.exists) throw new Error("Insumo Nutella não encontrado.");
if (!productSnapshot.exists) throw new Error("Produto Nutella 650 g não encontrado.");

const order = {
  workspaceId: "coala",
  sourceRef,
  origin: "direct",
  quotationId: null,
  supplierId,
  supplierName: "Cantinho Distribuidora",
  receiptMode: "future_delivery",
  status: "created",
  purchaseDate: "2026-07-21",
  estimatedReceiptDate: "2026-07-21",
  paymentDueDate: "2026-07-21",
  paymentMethod: "pix",
  paymentMethodLabel: "Pix",
  paymentAccountId: null,
  paymentAccountName: null,
  paymentMethodId: null,
  paymentCondition: "cash",
  installmentsCount: 1,
  installmentDueDates: [],
  deliveryFee: 0,
  totalEstimated: totalOrdered,
  totalConfirmed: 0,
  freightPaymentMode: null,
  accountPlanId: "OofGtZoVn15nmmy2xaI8",
  accountPlanName: "Insumos composição",
  freightAccountPlanId: "",
  freightAccountPlanName: "",
  resultCenterId: "KNKNWZ7tdhIxnrlStRum",
  resultCenterName: "Centro administrativo - Renascença",
  externalOrderNumber: "137768",
  trackingInfo:
    "Pedido força venda nº 137.768, pedido do cliente nº 140.147, marcado como Fechado pelo fornecedor.",
  notes: [
    "Compra lançada a partir do pedido enviado pela distribuidora.",
    "Data da solicitação: 21/07/2026.",
    "Grupo no documento: Gelados Comestíveis SLZ.",
    "Vendedora: Graciela Moraes Barbosa Lopes.",
    "Pedido força venda nº 137.768; pedido do cliente nº 140.147.",
    "Forma de pagamento: Pix, à vista.",
    "Produto: 20 potes de Nutella Ferrero 650 g, a R$ 39,99 cada, total de R$ 799,80.",
    "Peso total informado: 13 kg.",
    "O status Fechado pertence ao pedido do fornecedor. A compra interna foi mantida como Criada para confirmação e recebimento no Coala One.",
    "Nenhum recebimento, financeiro confirmado, lote, custo efetivo ou movimentação de estoque foi criado.",
  ].join(" "),
  createdAt: now,
  updatedAt: now,
  createdBy: "script-seed-cantinho-nutella-purchase-20260721",
};

const item = {
  baseItemId,
  productId,
  itemName: "Nutella Ferrero 650g",
  operationalCategoryId: "insumo",
  operationalCategoryName: "Perecíveis",
  itemDestination: "stock",
  entryType: "stock",
  itemTreatment: "stock",
  linkedAssetId: null,
  linkedAssetCode: null,
  linkedAssetName: null,
  componentAction: null,
  unit: "Pote",
  purchaseUnitType: "content",
  purchaseUnitLabel: "Pote",
  quantityOrdered,
  unitPriceOrdered,
  netUnitPriceOrdered: unitPriceOrdered,
  discountOrdered: 0,
  totalOrdered,
  quotationItemId: null,
  notes:
    "Código do fornecedor 3497. Embalagem UN/1. Produto vinculado ao derivado cadastrado Nutella Ferrero 650 g.",
};

if (!apply) {
  console.log(
    JSON.stringify(
      {
        status: "dry_run",
        sourceRef,
        supplier: {
          id: supplierSnapshot.id,
          ...clean(supplierSnapshot.data()),
        },
        baseProduct: {
          id: baseProductSnapshot.id,
          ...clean(baseProductSnapshot.data()),
        },
        product: {
          id: productSnapshot.id,
          ...clean(productSnapshot.data()),
        },
        order,
        item,
        reconciliation: Number(
          (quantityOrdered * unitPriceOrdered - totalOrdered).toFixed(2)
        ),
        netPricePerGram: totalOrdered / (quantityOrdered * 650),
      },
      null,
      2
    )
  );
  process.exit(0);
}

const orderReference = db.collection("purchase_orders").doc();
const itemReference = orderReference.collection("items").doc();
const batch = db.batch();
batch.set(orderReference, order);
batch.set(itemReference, {
  ...item,
  purchaseOrderId: orderReference.id,
});
await batch.commit();

const [savedOrder, savedItem] = await Promise.all([
  orderReference.get(),
  itemReference.get(),
]);

console.log(
  JSON.stringify(
    {
      status: "created",
      orderId: orderReference.id,
      itemId: itemReference.id,
      order: clean(savedOrder.data()),
      item: clean(savedItem.data()),
    },
    null,
    2
  )
);
