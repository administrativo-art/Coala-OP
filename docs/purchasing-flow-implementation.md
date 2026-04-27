# Documentação de Implementação — Fluxo de Cotações, Compras e Recebimento

## 1. Objetivo

Esta documentação define o novo fluxo do módulo de compras do Coala Estoque, separando claramente as etapas de:

1. Cotação;
2. Seleção para compra;
3. Compra;
4. Lançamento financeiro previsto;
5. Recebimento;
6. Entrada no estoque;
7. Confirmação financeira;
8. Histórico efetivo de custo.

O objetivo principal é evitar a confusão entre preço cotado, preço comprado e preço efetivamente recebido, garantindo rastreabilidade operacional, financeira e de estoque.

---

## 2. Regra central do módulo

A regra oficial do fluxo deve ser:

> A cotação registra preços informados por um fornecedor.
>
> A compra nasce a partir dos itens selecionados de uma cotação finalizada.
>
> A compra gera um financeiro previsto e um recebimento pendente com data estimada.
>
> O recebimento confirma o que chegou, ajusta divergências, movimenta estoque e grava o custo efetivo.
>
> Itens não cadastrados podem ser cotados, mas precisam ser cadastrados ou vinculados antes de virar compra.

---

## 3. Fluxo geral

```text
Cotação
→ Seleção para compra
→ Compra
→ Financeiro previsto
→ Recebimento pendente
→ Recebimento real
→ Entrada no estoque
→ Financeiro confirmado/ajustado
→ Histórico efetivo de custo
```

Resumo operacional:

```text
Fornecedor passou preço
→ usuário finaliza cotação
→ compara fornecedores
→ escolhe itens
→ cria compra
→ gera financeiro previsto
→ cria recebimento pendente
→ recebe mercadoria
→ entra no estoque
→ confirma financeiro
→ grava custo efetivo
```

---

## 4. Conceitos principais

### 4.1 Cotação

A cotação é sempre vinculada a um único fornecedor.

Uma cotação pode conter vários itens cotados.

Exemplo:

```text
Cotação — Atacadão

- Leite Piracanjuba 1L — R$ 6,90
- Morango congelado 1,2kg — R$ 28,00
- Ovomaltine 750g — R$ 31,50
```

A cotação não gera compra, não gera financeiro, não movimenta estoque e não atualiza custo efetivo.

Ela apenas registra preços informados pelo fornecedor.

### 4.2 Item cotado

Um item cotado pode ser:

1. Produto já cadastrado;
2. Item livre, ainda não cadastrado.

Produtos cadastrados podem seguir para compra.

Itens livres podem ser registrados na cotação, mas precisam ser cadastrados ou vinculados antes de virar compra.

### 4.3 Compra

A compra nasce a partir de itens selecionados dentro de uma cotação finalizada.

A compra representa a decisão da empresa de comprar determinados itens daquele fornecedor.

A compra ainda não movimenta estoque.

### 4.4 Recebimento

O recebimento é criado automaticamente quando a compra é criada.

Ele representa a etapa de conferência física dos produtos.

No recebimento, o usuário cria lotes, informa validade, confirma quantidade recebida e confirma fornecedor.

### 4.5 Estoque

O estoque só é movimentado no recebimento confirmado.

A compra não deve criar lote nem movimentação de estoque.

### 4.6 Financeiro

A cotação não gera financeiro.

A compra gera um lançamento financeiro previsto.

O recebimento confirma ou ajusta esse lançamento conforme nota, preço real e divergências.

---

## 5. Diferença entre preços

O sistema deve separar três conceitos:

| Conceito | Significado | Quando nasce | Impacta custo efetivo? |
|---|---|---|---|
| Preço cotado | Preço informado pelo fornecedor | Cotação finalizada | Não |
| Preço comprado | Preço usado na compra criada | Compra | Ainda não |
| Preço efetivo | Preço confirmado no recebimento/nota | Recebimento | Sim |

Regra:

```text
Preço cotado ≠ preço comprado ≠ preço efetivo
```

O `lastEffectivePrice` do insumo base só deve ser atualizado com preço efetivo, isto é, após recebimento confirmado.

---

## 6. Etapa 1 — Cotação

### 6.1 Criação da cotação

O usuário cria uma cotação informando obrigatoriamente o fornecedor.

Campos recomendados:

| Campo | Obrigatório | Observação |
|---|---:|---|
| Fornecedor | Sim | Deve vir de `entities` |
| Descrição | Sim | Ex.: Cotação Atacadão — 27/04/2026 |
| Data da cotação | Sim | Default: data atual |
| Observações | Não | Campo livre |

### 6.2 Status da cotação

Status sugeridos:

```ts
export type SupplierQuotationStatus =
  | "draft"
  | "quoted"
  | "partially_converted"
  | "converted"
  | "cancelled";
```

Representação na UI:

| Status técnico | Label na UI |
|---|---|
| `draft` | Em lançamento |
| `quoted` | Cotação finalizada |
| `partially_converted` | Parcialmente convertida |
| `converted` | Convertida em compra |
| `cancelled` | Cancelada |

### 6.3 Lançamento de itens

A cotação permite lançar:

1. Produto cadastrado;
2. Item livre/não cadastrado.

#### Produto cadastrado

Campos:

| Campo | Obrigatório |
|---|---:|
| Produto | Sim |
| Preço cotado | Sim |
| Unidade de compra | Sim |
| Quantidade desejada | Opcional |
| Observação | Opcional |

#### Item livre

Campos:

| Campo | Obrigatório |
|---|---:|
| Descrição | Sim |
| Marca | Não |
| Embalagem | Sim |
| Unidade | Sim |
| Preço cotado | Sim |
| Insumo base relacionado | Opcional, mas recomendado |
| Observação | Opcional |

### 6.4 Finalização da cotação

Botão recomendado:

```text
Finalizar cotação
```

Ao finalizar, o sistema deve:

1. Alterar status da cotação para `quoted`;
2. Bloquear edição livre dos preços;
3. Registrar os preços como preços cotados;
4. Manter itens livres marcados como pendentes de cadastro/vínculo;
5. Não criar compra;
6. Não criar financeiro;
7. Não criar recebimento;
8. Não movimentar estoque;
9. Não atualizar custo efetivo.

---

## 7. Etapa 2 — Comparativo

O comparativo deve reorganizar as cotações por insumo base.

Mesmo que a cotação seja criada por fornecedor, a análise deve ser por insumo base.

Exemplo:

```text
Leite integral

Assaí      — Italac 1L       — R$ 6,50/L
Atacadão   — Piracanjuba 1L  — R$ 6,90/L
```

```text
Morango

Atacadão   — Morango 1,2kg   — R$ 23,33/kg
Assaí      — Morango 1kg     — R$ 25,00/kg
```

O comparativo deve usar preço normalizado por unidade base:

- R$/kg;
- R$/L;
- R$/unidade;
- outra unidade base definida no insumo.

---

## 8. Etapa 3 — Seleção para compra

Dentro de uma cotação finalizada, o usuário seleciona os itens que deseja comprar.

Exemplo:

```text
Cotação — Atacadão

[ ] Leite Piracanjuba 1L
[x] Morango congelado 1,2kg
[x] Ovomaltine 750g
```

### 8.1 Regra de bloqueio

Itens livres podem ser cotados, mas não podem virar compra.

Antes de criar a compra, todos os itens selecionados devem estar vinculados a um produto cadastrado.

Mensagem recomendada:

```text
Existem itens selecionados que ainda não estão cadastrados.

Para criar a compra, cadastre ou vincule esses itens a um produto existente.
```

### 8.2 Botão

Botão recomendado:

```text
Criar compra deste fornecedor
```

---

## 9. Etapa 4 — Compra

A compra nasce a partir dos itens selecionados de uma cotação.

A compra pertence a um fornecedor.

A compra contém apenas os itens escolhidos pelo usuário.

### 9.1 Criação da compra

Ao criar a compra, o usuário deve informar:

| Campo | Obrigatório | Observação |
|---|---:|---|
| Data estimada de recebimento | Sim | Cria recebimento pendente |
| Condição de pagamento | Sim | Ex.: à vista, boleto, prazo |
| Data de vencimento financeiro | Sim | Para contas a pagar |
| Forma de pagamento | Recomendado | Pix, boleto, cartão, etc. |
| Observação | Não | Campo livre |

### 9.2 Status da compra

```ts
export type PurchaseOrderStatus =
  | "created"
  | "sent"
  | "awaiting_receipt"
  | "partially_received"
  | "received"
  | "cancelled"
  | "divergent";
```

Labels na UI:

| Status técnico | Label |
|---|---|
| `created` | Criada |
| `sent` | Pedido enviado |
| `awaiting_receipt` | Aguardando recebimento |
| `partially_received` | Recebida parcialmente |
| `received` | Recebida |
| `cancelled` | Cancelada |
| `divergent` | Com divergência |

### 9.3 Efeitos da criação da compra

Ao criar a compra, o sistema deve:

1. Criar `PurchaseOrder`;
2. Criar itens da compra;
3. Atualizar status dos itens da cotação selecionados;
4. Atualizar status da cotação para `partially_converted` ou `converted`;
5. Criar lançamento financeiro previsto;
6. Criar recebimento pendente;
7. Não movimentar estoque;
8. Não atualizar preço efetivo.

---

## 10. Etapa 5 — Financeiro previsto

A compra deve gerar um lançamento financeiro previsto.

A cotação não gera financeiro.

### 10.1 Dados mínimos do lançamento financeiro

| Campo | Origem |
|---|---|
| Fornecedor | Compra |
| Valor previsto | Soma dos itens comprados |
| Vencimento | Informado na criação da compra |
| Status | Previsto |
| Origem | Compra |
| ID da compra | `purchaseOrderId` |

### 10.2 Status financeiro sugerido

```ts
export type PurchaseFinancialStatus =
  | "forecasted"
  | "confirmed"
  | "partial"
  | "divergent"
  | "cancelled"
  | "paid";
```

Labels:

| Status técnico | Label |
|---|---|
| `forecasted` | Previsto |
| `confirmed` | Confirmado |
| `partial` | Parcial |
| `divergent` | Divergente |
| `cancelled` | Cancelado |
| `paid` | Pago |

---

## 11. Etapa 6 — Recebimento pendente

Ao criar a compra, o sistema deve criar automaticamente um recebimento pendente.

A data estimada de recebimento informada na compra será a data fim prevista do recebimento.

Exemplo:

```text
Compra criada em: 27/04/2026
Data estimada de recebimento: 30/04/2026
Recebimento criado com data fim prevista: 30/04/2026
```

### 11.1 Status do recebimento

```ts
export type PurchaseReceiptStatus =
  | "awaiting_receipt"
  | "partially_received"
  | "received"
  | "received_with_divergence"
  | "cancelled";
```

Label visual adicional:

```text
Atrasado
```

Regra para atraso:

```text
Se hoje > data fim prevista
E status = Aguardando recebimento
Então exibir como Atrasado
```

---

## 12. Etapa 7 — Recebimento real

No recebimento, o usuário deve:

1. Confirmar fornecedor;
2. Informar data real de recebimento;
3. Conferir cada item comprado;
4. Criar um ou mais lotes por item;
5. Registrar validade de cada lote;
6. Confirmar quantidade recebida de cada lote;
7. Garantir que a soma dos lotes bata com o total recebido do item;
8. Confirmar recebimento.

### 12.1 Regra por item

A lógica do recebimento é por item comprado, mas cada item pode ter múltiplos lotes.

Exemplo:

```text
Item: Morango congelado 1,2kg
Quantidade comprada: 10 pacotes
Quantidade recebida: 10 pacotes

Lotes:
- MOR-001 — validade 10/06/2026 — 6 pacotes
- MOR-002 — validade 18/06/2026 — 4 pacotes

Total dos lotes: 10 / 10
Status: OK
```

### 12.2 Regra da soma dos lotes

A soma das quantidades dos lotes deve bater com a quantidade recebida do item.

Correto:

```text
Quantidade comprada: 10
Quantidade recebida: 8
Soma dos lotes: 8
Status: Recebido parcialmente
```

Incorreto:

```text
Quantidade recebida: 8
Soma dos lotes: 7
```

Neste caso, o sistema deve bloquear a confirmação.

### 12.3 Quantidade recebida versus quantidade comprada

A quantidade dos lotes deve bater com a quantidade recebida, não necessariamente com a quantidade comprada.

Se a quantidade recebida for diferente da comprada, o sistema deve marcar divergência.

| Comprado | Recebido | Soma dos lotes | Status |
|---:|---:|---:|---|
| 10 | 10 | 10 | Recebido |
| 10 | 8 | 8 | Recebido parcialmente |
| 10 | 8 | 7 | Erro de conferência |
| 10 | 12 | 12 | Divergência positiva |
| 10 | 0 | 0 | Pendente ou não recebido |

### 12.4 Confirmação do fornecedor

O fornecedor já vem vinculado à compra.

No recebimento, o usuário apenas confirma.

Troca de fornecedor não deve ser permitida livremente.

Se o fornecedor estiver errado, o usuário deve cancelar/corrigir a compra ou acionar permissão especial.

---

## 13. Etapa 8 — Entrada no estoque

Ao confirmar o recebimento, o sistema deve:

1. Criar os lotes no estoque;
2. Registrar validade de cada lote;
3. Registrar quantidade de cada lote;
4. Registrar movimento de entrada;
5. Vincular lote à compra;
6. Vincular lote ao recebimento;
7. Vincular lote ao fornecedor;
8. Gravar custo do lote;
9. Atualizar status do recebimento;
10. Atualizar status da compra;
11. Confirmar ou ajustar financeiro;
12. Gravar histórico efetivo de custo.

Regra central:

```text
Compra não movimenta estoque.
Recebimento confirmado movimenta estoque.
```

---

## 14. Etapa 9 — Financeiro confirmado ou ajustado

No recebimento, o sistema deve comparar:

1. Valor previsto da compra;
2. Valor real da nota/recebimento.

Se os valores forem iguais:

```text
Financeiro previsto → confirmado
```

Se forem diferentes:

```text
Financeiro previsto → divergente
```

Mensagem sugerida:

```text
Valor previsto: R$ 59,50
Valor da nota: R$ 60,00

Deseja atualizar o lançamento financeiro?

[Manter previsto] [Atualizar para valor da nota]
```

---

## 15. Etapa 10 — Histórico efetivo de custo

O histórico efetivo de custo deve ser gravado apenas depois do recebimento confirmado.

Ao confirmar recebimento, o sistema deve gravar:

1. Produto;
2. Insumo base;
3. Fornecedor;
4. Preço efetivo;
5. Preço efetivo por unidade base;
6. Compra vinculada;
7. Recebimento vinculado;
8. Lote vinculado;
9. Usuário responsável;
10. Data de confirmação.

Esse histórico deve alimentar:

1. Último preço efetivo do insumo base;
2. Custo do lote;
3. CMV;
4. Ficha técnica;
5. Relatórios de custo;
6. Histórico de fornecedores.

---

## 16. Modelagem sugerida

### 16.1 SupplierQuotation

```ts
export type SupplierQuotation = {
  id: string;
  supplierId: string;
  description: string;
  status:
    | "draft"
    | "quoted"
    | "partially_converted"
    | "converted"
    | "cancelled";
  createdBy: string;
  createdAt: string;
  finalizedAt?: string;
  notes?: string;
};
```

### 16.2 QuotationItem

```ts
export type QuotationItem = {
  id: string;
  quotationId: string;
  supplierId: string;

  isCatalogItem: boolean;
  productId?: string;
  baseProductId?: string;
  freeTextDescription?: string;

  quotedPrice: number;
  quotedPricePerUnit?: number;
  purchaseUnit?: string;
  requestedQuantity?: number;

  requiresCatalogLink: boolean;

  status:
    | "quoted"
    | "selected_for_purchase"
    | "converted_to_order"
    | "not_selected"
    | "cancelled";

  createdAt: string;
  updatedAt?: string;
};
```

### 16.3 PurchaseOrder

```ts
export type PurchaseOrder = {
  id: string;
  quotationId: string;
  supplierId: string;

  status:
    | "created"
    | "sent"
    | "awaiting_receipt"
    | "partially_received"
    | "received"
    | "cancelled"
    | "divergent";

  selectedItemIds: string[];
  totalEstimated: number;

  estimatedReceiptDate: string;
  paymentDueDate: string;
  paymentCondition?: string;
  paymentMethod?: string;

  financialEntryId?: string;
  receiptId?: string;

  createdAt: string;
  createdBy: string;
  orderedAt?: string;
  receivedAt?: string;
  notes?: string;
};
```

### 16.4 PurchaseOrderItem

```ts
export type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  quotationItemId: string;
  supplierId: string;

  productId: string;
  baseProductId: string;

  orderedQuantity: number;
  quotedPrice: number;
  quotedPricePerUnit: number;

  receivedQuantity?: number;
  invoicePrice?: number;
  invoicePricePerUnit?: number;

  status:
    | "ordered"
    | "partially_received"
    | "received"
    | "divergent"
    | "cancelled";
};
```

### 16.5 PurchaseReceipt

```ts
export type PurchaseReceipt = {
  id: string;
  purchaseOrderId: string;
  supplierId: string;

  status:
    | "awaiting_receipt"
    | "partially_received"
    | "received"
    | "received_with_divergence"
    | "cancelled";

  expectedEndDate: string;

  createdAt: string;
  createdBy: string;

  receivedAt?: string;
  receivedBy?: string;

  items: PurchaseReceiptItem[];
};
```

### 16.6 PurchaseReceiptItem

```ts
export type PurchaseReceiptItem = {
  id: string;
  purchaseOrderItemId: string;
  productId: string;
  baseProductId: string;

  orderedQuantity: number;
  receivedQuantity?: number;

  quotedPrice: number;
  invoicePrice?: number;

  lots: PurchaseReceiptLot[];

  status:
    | "pending"
    | "received"
    | "partial"
    | "divergent"
    | "cancelled";
};
```

### 16.7 PurchaseReceiptLot

```ts
export type PurchaseReceiptLot = {
  id: string;
  lotNumber: string;
  expiryDate: string | null;
  quantity: number;
  unitCost?: number;
  totalCost?: number;
};
```

### 16.8 EffectivePriceHistoryEntry

```ts
export type EffectivePriceHistoryEntry = {
  id: string;
  baseProductId: string;
  productId: string;
  supplierId: string;

  purchaseOrderId: string;
  purchaseReceiptId: string;
  lotId?: string;

  price: number;
  pricePerUnit: number;

  confirmedBy: string;
  confirmedAt: string;
};
```

---

## 17. UI recomendada

### 17.1 Abas do módulo

```text
Cotações
Comparativo
Compras
Recebimentos
Histórico de preços
```

### 17.2 Tela de cotações

```text
Cotações

[ Nova cotação de fornecedor ]

Atacadão         Em lançamento              12 itens
Assaí            Cotação finalizada          8 itens
Distribuidora X  Parcialmente convertida     5 itens
```

### 17.3 Tela da cotação

Em lançamento:

```text
Cotação — Atacadão
Status: Em lançamento

[ + Adicionar item cotado ]

Produto                         Preço cotado       Preço normalizado
Leite Piracanjuba 1L             R$ 6,90            R$ 6,90/L
Morango congelado 1,2kg          R$ 28,00           R$ 23,33/kg
Ovomaltine 750g                  R$ 31,50           R$ 42,00/kg

[ Finalizar cotação ]
```

Finalizada:

```text
Cotação — Atacadão
Status: Cotação finalizada

[ ] Leite Piracanjuba 1L         R$ 6,90/L
[x] Morango congelado 1,2kg      R$ 23,33/kg
[x] Ovomaltine 750g              R$ 42,00/kg

2 itens selecionados
Total estimado: R$ 59,50

[ Criar compra deste fornecedor ]
```

### 17.4 Tela de criação da compra

```text
Criar compra — Atacadão

Itens selecionados:
- Morango congelado 1,2kg — R$ 28,00
- Ovomaltine 750g — R$ 31,50

Total estimado: R$ 59,50

Data estimada de recebimento: [ 30/04/2026 ]
Data de vencimento financeiro: [ 30/04/2026 ]
Condição de pagamento: [ Boleto ]
Forma de pagamento: [ A prazo ]
Observações: [ Pedido feito pelo WhatsApp ]

[Cancelar] [Criar compra]
```

### 17.5 Tela do recebimento

```text
Recebimento — Atacadão
Status: Aguardando conferência

Fornecedor
Atacadão  [confirmado]

Data prevista
30/04/2026

Data real de recebimento
[ 29/04/2026 ]

------------------------------------------------

Item 1 — Morango congelado 1,2kg
Quantidade comprada: 10
Quantidade recebida: [10]

Lotes:
[ MOR-001 ] [ 10/06/2026 ] [ 6 ]
[ MOR-002 ] [ 18/06/2026 ] [ 4 ]

Total dos lotes: 10 / 10
Status: OK

------------------------------------------------

Item 2 — Ovomaltine 750g
Quantidade comprada: 6
Quantidade recebida: [5]

Lotes:
[ OVO-778 ] [ 20/09/2026 ] [ 5 ]

Total dos lotes: 5 / 5
Diferença em relação à compra: -1
Status: Recebido com divergência

------------------------------------------------

[Salvar rascunho] [Confirmar recebimento]
```

---

## 18. Regras de validação

### 18.1 Cotação

- Cotação exige fornecedor.
- Cotação pode conter produto cadastrado ou item livre.
- Item livre precisa de descrição, unidade e preço.
- Item cadastrado precisa de `productId`.
- Finalizar cotação não pode gerar compra automaticamente.

### 18.2 Compra

- Compra só pode ser criada a partir de cotação finalizada.
- Compra só pode conter itens cadastrados.
- Compra exige data estimada de recebimento.
- Compra exige data de vencimento financeiro.
- Compra gera financeiro previsto.
- Compra gera recebimento pendente.
- Compra não movimenta estoque.

### 18.3 Recebimento

- Recebimento deve confirmar fornecedor vinculado.
- Cada item recebido deve ter quantidade recebida.
- Cada item pode ter um ou mais lotes.
- Cada lote deve ter número de lote.
- Cada lote deve ter validade quando aplicável.
- Soma dos lotes deve ser igual à quantidade recebida do item.
- Quantidade recebida pode ser diferente da comprada, mas deve marcar divergência.
- Confirmar recebimento cria lotes e movimentações de estoque.
- Confirmar recebimento grava custo efetivo.

### 18.4 Financeiro

- Cotação não gera financeiro.
- Compra gera financeiro previsto.
- Recebimento confirma ou ajusta financeiro.
- Divergência entre valor previsto e valor real deve ser destacada.

---

## 19. Pontos de atenção no código atual

O fluxo atual ainda usa `purchaseSessions`, `purchaseItems` e `priceHistory` de forma simplificada.

Atualmente, o fechamento da sessão grava histórico de preço e atualiza `lastEffectivePrice` no insumo base.

No novo fluxo, essa responsabilidade deve ser movida para o recebimento.

Regras de alteração:

1. Finalizar cotação não deve atualizar `priceHistory` efetivo.
2. Finalizar cotação não deve atualizar `baseProducts.lastEffectivePrice`.
3. Criar compra deve gerar financeiro previsto e recebimento pendente.
4. Confirmar recebimento deve criar lotes, movimentar estoque e gravar custo efetivo.

---

## 20. Roadmap de implementação

### PR 1 — Cotação por fornecedor

Escopo:

1. Exigir fornecedor na criação da cotação.
2. Ajustar nomenclatura da UI.
3. Criar status da cotação.
4. Permitir item cadastrado e item livre.
5. Finalizar cotação sem criar compra.
6. Separar preço cotado de preço efetivo.

### PR 2 — Comparativo e seleção para compra

Escopo:

1. Criar comparativo por insumo base.
2. Mostrar preços normalizados.
3. Permitir seleção de itens dentro da cotação finalizada.
4. Bloquear item livre selecionado para compra.
5. Validar vínculo com produto cadastrado.

### PR 3 — Compra e financeiro previsto

Escopo:

1. Criar `PurchaseOrder`.
2. Criar itens da compra.
3. Exigir data estimada de recebimento.
4. Exigir vencimento financeiro.
5. Gerar financeiro previsto.
6. Criar recebimento pendente.
7. Atualizar status da cotação.

### PR 4 — Recebimento com lotes

Escopo:

1. Criar tela de recebimento.
2. Permitir múltiplos lotes por item.
3. Validar soma dos lotes.
4. Confirmar fornecedor.
5. Registrar data real de recebimento.
6. Marcar divergências.

### PR 5 — Entrada no estoque e custo efetivo

Escopo:

1. Criar lotes no estoque.
2. Registrar movimento de entrada.
3. Vincular lote à compra e recebimento.
4. Gravar preço efetivo.
5. Atualizar `lastEffectivePrice`.
6. Ajustar financeiro conforme nota/recebimento.

---

## 21. Critérios de aceite

### Cotação

- Usuário consegue criar cotação vinculada a fornecedor.
- Usuário consegue lançar vários itens na cotação.
- Usuário consegue lançar item livre.
- Usuário consegue finalizar cotação sem gerar compra.
- Preço cotado fica registrado separadamente do preço efetivo.

### Compra

- Usuário consegue selecionar parcialmente itens de uma cotação.
- Sistema bloqueia compra se houver item livre selecionado.
- Sistema exige data estimada de recebimento.
- Sistema gera compra com apenas os itens selecionados.
- Sistema gera financeiro previsto.
- Sistema gera recebimento pendente.

### Recebimento

- Usuário consegue confirmar fornecedor.
- Usuário consegue informar data real de recebimento.
- Usuário consegue criar um ou mais lotes por item.
- Sistema exige validade quando aplicável.
- Sistema valida soma dos lotes.
- Sistema permite divergência entre comprado e recebido.
- Sistema bloqueia divergência entre recebido e soma dos lotes.
- Ao confirmar, estoque é movimentado.

### Financeiro e custo

- Compra gera financeiro previsto.
- Recebimento confirma ou ajusta financeiro.
- Custo efetivo só é gravado no recebimento.
- `lastEffectivePrice` só muda após recebimento confirmado.

---

## 22. Glossário

| Termo | Definição |
|---|---|
| Cotação | Registro de preços enviados por um fornecedor |
| Item cotado | Produto ou item livre informado na cotação |
| Compra | Decisão de comprar itens selecionados de uma cotação |
| Recebimento | Conferência física dos produtos comprados |
| Lote | Entrada real de produto no estoque, com quantidade e validade |
| Preço cotado | Preço informado pelo fornecedor |
| Preço efetivo | Preço confirmado após recebimento |
| Financeiro previsto | Conta a pagar gerada a partir da compra |
| Financeiro confirmado | Conta a pagar confirmada ou ajustada após recebimento |
