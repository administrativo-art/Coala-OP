import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const apply = process.argv.includes("--apply");
const sourceRef = "nfe-1564-gab-20260727";
const invoiceAccessKey = "52260764433090000197550010000015641000211943";
const supplierId = "gab-industria-grafica-natucopos-express";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) {
    return cert(JSON.parse(readFileSync(path, "utf8")));
  }
  return applicationDefault();
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");

const purchaseOrders = await db.collection("purchase_orders").get();
const duplicates = purchaseOrders.docs.filter((document) => {
  const data = document.data();
  return document.id === sourceRef
    || data.sourceRef === sourceRef
    || String(data.invoiceAccessKey ?? "").replace(/\D/g, "") === invoiceAccessKey
    || (data.supplierId === supplierId && String(data.invoiceNumber ?? "") === "1564");
});

if (duplicates.length > 0) {
  console.log(JSON.stringify({
    status: "already_exists",
    sourceRef,
    orders: duplicates.map((document) => ({ id: document.id, ...clean(document.data()) })),
  }, null, 2));
  process.exit(0);
}

const references = {
  supplier: db.collection("entities").doc(supplierId),
  cup120Base: db.collection("baseProducts").doc("cBNVJZuF0FGyN4GQCcLr"),
  cup120Product: db.collection("products").doc("JkB3Ja0fTC4OBjzojdNf"),
  cup240Base: db.collection("baseProducts").doc("NMckBe86Ys8gid6m59qi"),
  cup240Product: db.collection("products").doc("iPeBItWIE4HJ2gyHdkLs"),
};
const referenceEntries = Object.entries(references);
const referenceSnapshots = await Promise.all(referenceEntries.map(([, reference]) => reference.get()));
referenceSnapshots.forEach((snapshot, index) => {
  assert(snapshot.exists, `Cadastro obrigatório não encontrado: ${referenceEntries[index][0]} (${snapshot.ref.path}).`);
});
assert(referenceSnapshots[1].get("unit") === "un", "COPO 120ML não está com a unidade canônica 'un'.");
assert(referenceSnapshots[2].get("baseProductId") === references.cup120Base.id, "Produto Natucopos 120ml aponta para outro insumo base.");
assert(referenceSnapshots[3].get("unit") === "un", "COPO 240ML não está com a unidade canônica 'un'.");
assert(referenceSnapshots[4].get("baseProductId") === references.cup240Base.id, "Produto Natucopos 240ml aponta para outro insumo base.");

const now = new Date().toISOString();
const order = {
  workspaceId: "coala",
  sourceRef,
  origin: "direct",
  quotationId: null,
  supplierId,
  supplierName: "GAB INDUSTRIA GRAFICA LTDA",
  receiptMode: "future_delivery",
  status: "created",
  purchaseDate: "2026-07-27",
  estimatedReceiptDate: "2026-07-27",
  paymentDueDate: "2026-08-24",
  paymentMethod: "boleto",
  paymentMethodLabel: null,
  paymentAccountId: null,
  paymentAccountName: null,
  paymentMethodId: null,
  paymentCondition: "installments",
  installmentsCount: 3,
  installmentDueDates: ["2026-08-24", "2026-08-31", "2026-09-07"],
  deliveryFee: 0,
  totalEstimated: 2753.82,
  totalConfirmed: 0,
  freightPaymentMode: null,
  invoiceNumber: "1564",
  invoiceAccessKey,
  fiscal: {
    operationNature: "Venda de Producao do Estabelecimento",
    model: "55",
    series: "1",
    number: "1564",
    issuedAt: "2026-07-27T11:02:00-03:00",
    entryAt: "2026-07-27T11:07:00-03:00",
    protocol: "152260686314702",
    issuerCnpj: "64.433.090/0001-97",
    issuerIe: "203606612",
    issuerName: "GAB Industria Grafica Ltda",
    issuerCity: "Neropolis",
    issuerUf: "GO",
    recipientName: "CT SORVETES LTDA",
    recipientCnpj: "14.276.603/0003-97",
    recipientCity: "Sao Luis",
    recipientUf: "MA",
    productsTotal: 2753.82,
    discountTotal: 89.49,
    ipiTotal: 89.49,
    icmsBase: 2753.82,
    icmsTotal: 330.46,
    invoiceTotal: 2753.82,
  },
  accountPlanId: "gdNkWMam7BQbaRADNZTm",
  accountPlanName: "Embalagens de venda compradas para estoque",
  freightAccountPlanId: "",
  freightAccountPlanName: "",
  resultCenterId: "KNKNWZ7tdhIxnrlStRum",
  resultCenterName: "Centro administrativo - Renascença",
  trackingInfo: "Transportadora SIGMA LOG; 7 caixas; peso líquido 44,10 kg.",
  externalOrderNumber: "147745",
  notes: [
    "Compra lançada a partir do DANFE da NF-e nº 1.564, série 1, emitida em 27/07/2026 por GAB Industria Grafica Ltda (CNPJ 64.433.090/0001-97) para CT SORVETES LTDA.",
    "Chave de acesso: 5226 0764 4330 9000 0197 5500 1000 0015 6410 0021 1943. Protocolo: 152260686314702.",
    "Orçamento 147745 - COALA SHAKES; vendedor Rafael - Melo. Total dos produtos R$ 2.753,82; desconto R$ 89,49 e IPI R$ 89,49, resultando no total da nota de R$ 2.753,82.",
    "Faturas: 001564/01 em 24/08/2026, 001564/02 em 31/08/2026 e 001564/03 em 07/09/2026, cada uma de R$ 917,94.",
    "Compra mantida como Criada para conferência manual. Este lançamento não confirma recebimento, não movimenta estoque e não recria os três boletos já tratados separadamente.",
  ].join(" "),
  createdAt: now,
  updatedAt: now,
  createdBy: "script-seed-nfe-1564-gab-20260727",
};

const commonItem = {
  operationalCategoryId: "UUcZTjxW2rSkFTN9og8V",
  operationalCategoryName: "Descartáveis",
  itemDestination: "stock",
  entryType: "stock",
  itemTreatment: "stock",
  linkedAssetId: null,
  linkedAssetCode: null,
  linkedAssetName: null,
  componentAction: null,
  unit: "un",
  purchaseUnitType: "content",
  purchaseUnitLabel: "un",
  quotationItemId: null,
};

const items = [
  {
    ...commonItem,
    baseItemId: references.cup120Base.id,
    productId: references.cup120Product.id,
    itemName: "POTE PERSONALIZADO 120 ML (ROSA)",
    quantityOrdered: 4000,
    unitPriceOrdered: 0.31473,
    netUnitPriceOrdered: 0.31473,
    discountOrdered: 0,
    totalOrdered: 1258.92,
    notes: "Código P1564-01. NCM 48111090; CST 000; CFOP 6101. BC ICMS R$ 1.258,92; ICMS R$ 151,07 (12%); IPI R$ 40,91 (3,25%).",
  },
  {
    ...commonItem,
    baseItemId: references.cup240Base.id,
    productId: references.cup240Product.id,
    itemName: "POTE PERSONALIZADO 240 ML (AZUL)",
    quantityOrdered: 3000,
    unitPriceOrdered: 0.4983,
    netUnitPriceOrdered: 0.4983,
    discountOrdered: 0,
    totalOrdered: 1494.90,
    notes: "Código P1564-02. NCM 48111090; CST 000; CFOP 6101. BC ICMS R$ 1.494,90; ICMS R$ 179,39 (12%); IPI R$ 48,58 (3,25%).",
  },
];

const sumItems = Number(items.reduce((sum, item) => sum + item.totalOrdered, 0).toFixed(2));
const sumInstallments = Number((3 * 917.94).toFixed(2));
assert(sumItems === order.totalEstimated, `Soma dos itens (${sumItems}) difere do total da compra (${order.totalEstimated}).`);
assert(sumInstallments === order.totalEstimated, `Soma das parcelas (${sumInstallments}) difere do total da compra (${order.totalEstimated}).`);

if (!apply) {
  console.log(JSON.stringify({
    status: "dry_run",
    sourceRef,
    references: Object.fromEntries(referenceEntries.map(([key, reference]) => [key, reference.path])),
    order,
    items,
    checksum: { sumItems, sumInstallments, totalEstimated: order.totalEstimated },
  }, null, 2));
  process.exit(0);
}

const orderRef = db.collection("purchase_orders").doc(sourceRef);
const itemRefs = [orderRef.collection("items").doc("p1564-01"), orderRef.collection("items").doc("p1564-02")];
const batch = db.batch();
batch.create(orderRef, order);
items.forEach((item, index) => {
  batch.create(itemRefs[index], { ...item, purchaseOrderId: orderRef.id });
});
await batch.commit();

const savedOrder = await orderRef.get();
const savedItems = await Promise.all(itemRefs.map((reference) => reference.get()));
assert(savedOrder.exists, "A compra não foi encontrada depois da gravação.");
assert(savedItems.every((snapshot) => snapshot.exists), "Nem todos os itens foram encontrados depois da gravação.");
assert(savedOrder.get("status") === "created", "A compra foi gravada com status inesperado.");
assert(savedItems.reduce((sum, snapshot) => sum + snapshot.get("totalOrdered"), 0) === order.totalEstimated, "A soma persistida dos itens diverge do total da compra.");

console.log(JSON.stringify({
  status: "created",
  orderId: orderRef.id,
  order: clean(savedOrder.data()),
  items: savedItems.map((snapshot) => ({ id: snapshot.id, ...clean(snapshot.data()) })),
  checksum: { sumItems, sumInstallments, totalEstimated: order.totalEstimated },
}, null, 2));
process.exit(0);
