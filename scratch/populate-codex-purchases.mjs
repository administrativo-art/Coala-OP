import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const serviceAccount = JSON.parse(
  readFileSync('scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json', 'utf8')
);

const app = getApps()[0] || initializeApp({
  credential: cert(serviceAccount),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore(app, 'coala');
const now = new Date().toISOString();
const createdBy = 'codex-populacao-compras';

const orders = [
  {
    id: 'codex-ml-extensor-inox-20260602',
    data: {
      workspaceId: 'coala',
      origin: 'direct',
      quotationId: null,
      supplierId: 'kxuQMC1QTu52MpFYLpVf',
      supplierName: 'Mercado Livre',
      receiptMode: 'future_delivery',
      status: 'created',
      purchaseDate: '2026-06-02',
      estimatedReceiptDate: '2026-06-09',
      paymentDueDate: '2026-06-02',
      paymentMethod: 'card_credit',
      paymentMethodLabel: 'Banco Inter S.A. **** 1127',
      paymentCondition: 'cash',
      installmentsCount: 1,
      deliveryFee: 0,
      totalEstimated: 386.58,
      totalConfirmed: 0,
      freightPaymentMode: 'included_with_goods',
      trackingInfo: null,
      notes: [
        'Compra lancada pelo Codex a partir de print de checkout do Mercado Livre.',
        'Status visto na origem: tela Revise e confirme, botao Confirmar a compra; compra mantida como Criada para revisao e confirmacao manual.',
        'Forma de pagamento exibida: Banco Inter S.A. **** 1127, 1x R$ 386,58.',
        'Resumo visto: Produtos (3) R$ 386,58; Frete gratis com valor anterior riscado de R$ 59,60; total anterior riscado R$ 446,18; economia exibida R$ 59,60.',
        'Entrega vista: chegara no endereco entre domingo e terca-feira.',
        'Endereco exibido: Avenida Coronel Colares Moreira 01.',
        'Itens livres nao normalizados; usuario deve revisar vinculos/cadastros depois.',
        'Nenhum recebimento, financeiro confirmado, lote ou movimentacao de estoque foi criado pelo Codex.',
      ].join(' '),
      createdAt: now,
      updatedAt: now,
      createdBy,
    },
    items: [
      {
        baseItemId: '',
        productId: null,
        itemName: 'Extensor Inox Resistente Profissional Copo Alto Milk Shake',
        operationalCategoryId: null,
        operationalCategoryName: null,
        itemDestination: 'asset',
        entryType: 'asset',
        unit: 'un',
        purchaseUnitType: 'content',
        purchaseUnitLabel: 'un',
        quantityOrdered: 3,
        unitPriceOrdered: 128.86,
        discountOrdered: 0,
        totalOrdered: 386.58,
        quotationItemId: null,
        notes: 'Item livre conforme print do Mercado Livre. Quantidade exibida: 3. Classificado preliminarmente como patrimonio para revisao manual do usuario.',
      },
    ],
  },
  {
    id: 'codex-quality-cofres-d6de8693f0',
    data: {
      workspaceId: 'coala',
      origin: 'direct',
      quotationId: null,
      supplierId: '',
      supplierName: 'Quality Cofres',
      receiptMode: 'future_delivery',
      status: 'created',
      purchaseDate: '2026-05-19',
      estimatedReceiptDate: '2026-05-26',
      paymentDueDate: '2026-05-19',
      paymentMethod: 'pix',
      paymentMethodLabel: 'Pix a vista',
      paymentCondition: 'cash',
      installmentsCount: 1,
      invoiceNumber: '6071',
      invoiceAccessKey: '35260529548433000168550010000060711719267038',
      fiscal: {
        issuerName: 'Quality Cofres',
        number: '6071',
        series: '1',
        issuedAt: '2026-05-20',
      },
      deliveryFee: 46.59,
      totalEstimated: 426.5,
      totalConfirmed: 0,
      freightPaymentMode: 'separate',
      trackingInfo: 'Prazo de ate 6 dias uteis para entrega do pedido.',
      notes: [
        'Compra lancada pelo Codex a partir de print/documento de pedido da Quality Cofres.',
        'Pedido externo: D6DE8693F0.',
        'Status visto na origem: Confirmado.',
        'Pagamento visto: Pix (a vista).',
        'Cliente/nome exibido: Coala Shakes. CNPJ exibido: 14.276.603/0003-97.',
        'Nota fiscal vista no historico: numero 6071, serie 1, chave 35260529548433000168550010000060711719267038, adicionada em 20/05/2026.',
        'Produto: Cofre Eletronico Digital 1723 com Boca de Lobo, REF SPLCASHB, SKU SPLCASHB.',
        'Subtotal R$ 399,90; desconto R$ 19,99; entrega Correios PAC R$ 46,59; total R$ 426,50.',
        'Compra mantida como Criada para revisao e confirmacao manual.',
        'Item livre nao normalizado; usuario deve revisar vinculos/cadastros depois.',
        'Nenhum recebimento, financeiro confirmado, lote, patrimonio ou movimentacao de estoque foi criado pelo Codex.',
      ].join(' '),
      createdAt: now,
      updatedAt: now,
      createdBy,
    },
    items: [
      {
        baseItemId: '',
        productId: null,
        itemName: 'Cofre Eletronico Digital 1723 com Boca de Lobo',
        operationalCategoryId: null,
        operationalCategoryName: null,
        itemDestination: 'asset',
        entryType: 'asset',
        unit: 'un',
        purchaseUnitType: 'content',
        purchaseUnitLabel: 'un',
        quantityOrdered: 1,
        unitPriceOrdered: 399.9,
        discountOrdered: 19.99,
        totalOrdered: 379.91,
        quotationItemId: null,
        notes: 'Item livre conforme documento Quality Cofres. REF SPLCASHB. SKU SPLCASHB. Subtotal bruto R$ 399,90 e desconto R$ 19,99 registrados no pedido.',
      },
    ],
  },
  {
    id: 'codex-logrosoft-pingador-d520-50211',
    data: {
      workspaceId: 'coala',
      origin: 'direct',
      quotationId: null,
      supplierId: '',
      supplierName: 'Logrosoft Com. Imp. Exp. e Prest. de Servicos LTDA',
      receiptMode: 'future_delivery',
      status: 'created',
      purchaseDate: '2026-06-02',
      estimatedReceiptDate: '2026-06-11',
      paymentDueDate: '2026-06-02',
      paymentMethod: 'bank_deposit',
      paymentMethodLabel: 'Deposito em banco',
      paymentCondition: 'cash',
      installmentsCount: 1,
      deliveryFee: 41,
      totalEstimated: 130.4,
      totalConfirmed: 0,
      freightPaymentMode: 'separate',
      trackingInfo: 'Frete PAC com prazo informado de 9 dias. AOS CUIDADOS: HEUCILENE.',
      notes: [
        'Compra lancada pelo Codex a partir do PDF PEDIDO HEUCILENE OCKTA.',
        'Pedido externo: 50211.',
        'Data vista no documento: 02/06/2026. Entrega exibida: 02/06/2026. Prazo/frete informado: PAC 9 dias.',
        'Fornecedor visto: LOGROSOFT COM. IMP. EXP E PREST. DE SERVICOS LTDA. CNPJ exibido: 38116840000197.',
        'Status visto na origem: PAG CONFIRMADO PELA ANA.',
        'Forma de pagamento vista: 009 - A VISTA DEP. BANCARIO / Deposito em banco.',
        'Totais vistos: mercadorias R$ 89,40; frete R$ 41,00; descontos R$ 0,00; total R$ 130,40.',
        'Item visto: codigo 1134271219, PINGADOR (BANDEJA GOTEJAMENTO) D520, quantidade 1 UN, valor unitario R$ 89,40.',
        'Item lancado como livre e classificado preliminarmente como componente de patrimonio para revisao manual e vinculacao posterior ao patrimonio correto.',
        'Compra mantida como Criada para revisao e confirmacao manual.',
        'Nenhum recebimento, financeiro confirmado, lote, patrimonio ou movimentacao de estoque foi criado pelo Codex.',
      ].join(' '),
      createdAt: now,
      updatedAt: now,
      createdBy,
    },
    items: [
      {
        baseItemId: '',
        productId: null,
        itemName: 'PINGADOR (BANDEJA GOTEJAMENTO) D520',
        operationalCategoryId: null,
        operationalCategoryName: 'Componente de patrimonio',
        itemDestination: 'expense',
        entryType: 'expense',
        itemTreatment: 'asset_component',
        linkedAssetId: null,
        linkedAssetCode: null,
        linkedAssetName: null,
        componentAction: 'replacement',
        unit: 'un',
        purchaseUnitType: 'content',
        purchaseUnitLabel: 'un',
        quantityOrdered: 1,
        unitPriceOrdered: 89.4,
        discountOrdered: 0,
        totalOrdered: 89.4,
        quotationItemId: null,
        notes: 'Item livre conforme PDF do pedido Logrosoft 50211. Codigo 1134271219. Tratamento preliminar: componente de patrimonio/peca de reposicao; usuario deve vincular ao patrimonio correto antes de confirmar.',
      },
    ],
  },
];

for (const order of orders) {
  const ref = db.collection('purchase_orders').doc(order.id);
  const snap = await ref.get();
  if (snap.exists) {
    console.log('SKIP existing order', order.id);
    continue;
  }

  await ref.set(order.data);
  const batch = db.batch();
  for (const item of order.items) {
    const itemRef = ref.collection('items').doc();
    batch.set(itemRef, { ...item, purchaseOrderId: order.id });
  }
  await batch.commit();
  console.log('CREATED', order.id, order.data.supplierName, order.data.totalEstimated);
}
