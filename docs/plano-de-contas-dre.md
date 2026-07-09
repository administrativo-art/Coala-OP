# Vinculação do Plano de Contas com a DRE

> Estado após a migração de 2026-07-08, banco Firestore `coala-financeiro` (94 contas). A migração one-shot foi removida de `scripts/` após confirmação em produção; o histórico permanece no Git. Snapshot pré-migração em `backups/plano-contas-20260708/`.

## Como funciona

Cada conta do plano de contas tem dois campos que controlam sua presença na DRE:

- **`dre_position`** — a linha da DRE em que as despesas classificadas nessa conta são somadas. As posições disponíveis são fixas no código (`DRE_POSITIONS` em `src/features/financial/components/settings/account-plans-management.tsx`): Impostos e deduções, Custos variáveis, Pessoal, Despesas operacionais, Ocupação, Despesas financeiras, Receita financeira, Receita não operacional, Despesa não operacional e IR/CSLL.
- **`is_dre_account`** — quando `false`, a conta é **patrimonial**: nunca entra na DRE, nem na linha "Não classificado" (ex.: compras para estoque, imobilizado, aplicações).

A DRE (`src/features/financial/pages/dre-page.tsx`) soma cada despesa **paga** (`status: "paid"`, competência por `paidAt`) na linha correspondente ao `dre_position` da conta em que a despesa foi classificada. O mapeamento é da própria conta, sem herança do grupo pai.

Duas linhas não dependem do plano de contas:

- **Receita Bruta** — vem de `transactions` com `direction: "in"` (excluindo transferências).
- **CMV** — automático via PDV: `salesReports.items` × `totalCmv` das `productSimulations`.

Regras aplicadas em 2026-07-08:

- **Lançamento só em conta folha**: contas com filhas são grupos e não aparecem no seletor de despesas nem são selecionáveis no seletor de compras; a API de compras valida (conta existente, ativa e folha).
- Cada conta tem **keywords** (`searchTerms`, máx. 20 — usadas na busca dos seletores) e **descrição/conceito** (exibida como subtítulo nos seletores).
- O campo `group` de todas as contas foi normalizado (contas com `group` nulo ficavam invisíveis no seletor de despesas).

Legenda: **[patrimonial]** = `is_dre_account: false`, fora da DRE. *(inativa)* = conta desativada (histórico preservado; a DRE continua lendo contas inativas).

## 1. Receita — grupo sem vínculo (receita vem das transações, não do plano)

Todas as filhas estão **inativas** — eram contas informativas com posições `receita_bruta_*` que a DRE não lê: **Venda balcão (PDV)** *(inativa em 2026-07-08)*, **Venda delivery** *(inativa)*, **Venda evento / ativação** *(inativa)*.

## 2. Impostos e deduções → linha (-) Impostos e deduções (`impostos_deducoes`)

Grupo e todas as filhas: **DAS**, **DARE**, **Devoluções / cancelamentos**, **Descontos concedidos**.

## 3. Custos variáveis complementares → linha (-) Insumos e fretes de aquisição (`custos_variaveis`)

Grupo e filhas: **Ajustes de CMV / perdas não previstas**, **Perdas extraordinárias de insumos**, **Ajustes de inventário**, **Fretes variáveis não incluídos no produto**, **Embalagens avulsas fora da ficha técnica**, **Outros custos variáveis complementares**.

## 4. Recursos humanos → linha (-) Pessoal (`pessoal`)

Tudo com `pessoal`: **Folha de pagamento** (grupo, com **Salários**, **INSS patronal**, **FGTS**, **Comissões de colaboradores**, **Bonificações / premiações de equipe**), **Vale-transporte**, **Plano odontológico**, **Vale alimentação**, **Contribuição sindical**.

## 5. Administrativo → linha (-) Despesas operacionais (`despesas_operacionais`)

- **Manutenção e conservação** (grupo) → Manutenção da máquina de sorvete, Manutenção de equipamentos, Pequenos reparos da unidade
- **Terceirizados** (grupo) → **Consultoria de RH** (ex-"Recursos Humanos"), Publicidade e propaganda *(inativa)*, Logística
- **Marketing** (grupo) → Material gráfico, Influenciadores | parcerias, **Agência | marketing terceirizado** (ex-"Terceirizado - Propaganda e Marketing"), **Redes sociais | mídia paga**, **Publicidade geral | offline** (ex-"Propaganda e publicidade")
- **Frete** (grupo) → Frete | Movimentação interna, Frete | Compras gerais
- **Honorários do contador**, **Materiais de limpeza e consumo** (fusão: ex-"Materiais de consumo da operação"; "Materiais de limpeza" *(inativa)*), **Utensílios e itens operacionais**, **Uniformes e EPIs** (criada em 2026-07-08, id `uniformes_epis_v1`), **Depreciação de ativo imobilizado** *(inativa)*

## 6. Estoque / Compras de insumos — [patrimonial], fora da DRE

Grupo e todas as filhas: **Insumos composição**, **Embalagens de venda compradas para estoque**, **Toppings, caldas e complementos**, **Produtos de revenda**, **Outras compras para estoque** (ex-"Compras de mercadorias para estoque").

(Correto: a compra vira estoque; o custo entra na DRE via CMV automático do PDV. Atenção: classificação errada aqui **some** da DRE — teste "isso vira produto vendido?".)

## 7. Tecnologia → linha (-) Despesas operacionais (`despesas_operacionais`)

- **Inteligência artificial** (grupo) → Gemini, GPT/Codex, Claude/Claude code
- **Internet**, **Sistema PDV**, **Sinalização digital**, **Sistema RH**, **Conta de celular**

## 8. Ocupação → linha (-) Ocupação (`ocupacao`)

Grupo e filhas: **Aluguel**, **Condomínio**, **Energia elétrica**, **Água**, **IPTU | taxas do ponto**.

## 9. Financeiro → resultado financeiro

| Conta | Vínculo DRE |
|---|---|
| Financeiro (grupo) | `despesas_financeiras` |
| IOF \| tarifas bancárias | `despesas_financeiras` |
| Juros e multas | `despesas_financeiras` |
| Taxas de cartão | `despesas_financeiras` |
| Taxas de antecipação de recebíveis | `despesas_financeiras` |
| Receita financeira | `receita_financeira` (linha (+) Receita financeira) |

## 10. Não operacional — grupo sem vínculo próprio (não selecionável: tem filhas)

| Conta | Vínculo DRE |
|---|---|
| Despesa não operacional | `despesa_nao_operacional` → (-) Despesa não operacional |
| Receita não operacional | `receita_nao_operacional` → (+) Receita não operacional |

## 11. IR / CSLL *(grupo inativo desde 2026-07-08)*

Filhas **CSLL** e **IRPJ** já estavam *(inativas)*; o grupo foi inativado junto (select ficava vazio).

## 12–13. Grupos patrimoniais — fora da DRE

- **Ativo imobilizado | Bens duráveis**: Equipamentos e maquinários, Móveis e utensílios, Equipamentos de informática e tecnologia, Obras, reformas e instalações
- **Aplicações financeiras | Investimentos financeiros**: Aplicação em renda fixa, Reserva de caixa, **Fundos e outros investimentos** (ex-"CDB / fundos / investimentos")

## Histórico da migração de 2026-07-08

- 7 renomes semânticos + 4 cosméticos, todos preservando IDs (histórico continua vinculado).
- Fusão: "Materiais de consumo da operação" → "Materiais de limpeza e consumo"; "Materiais de limpeza" inativada (0 lançamentos).
- 1 conta criada: Uniformes e EPIs.
- 67 contas com `searchTerms` e 56 com `description` (conceito exibido nos seletores).
- `group` normalizado em 21 contas (6 delas estavam invisíveis no seletor de despesas); árvores patrimoniais ganharam chaves próprias: `patrimonial` (Ativo imobilizado) e `investimentos` (Aplicações).
- Reparo de referências órfãs de 4 contas deletadas no passado: "Insumos gerais" → Insumos composição; antiga "Manutenção da máquina de sorvete" → conta atual; "Frete de adquirir insumos" e "Frete de deslocamento de máquinas" (em `freightAccountPlanId`) → Frete | Compras gerais. 2 despesas e 1 pedido lançados no grupo "Manutenção e conservação" reclassificados.

## Observações

- **Cobertura completa**: nenhuma conta ativa de despesa está sem vínculo — tudo ou tem `dre_position` ou é patrimonial.
- **Mapeamento é da própria conta** (sem herança). Com o bloqueio de lançamento em grupos, toda despesa nova cai em conta folha com posição definida.
- A linha "Não classificado" da DRE só receberia lançamentos legados anteriores ao bloqueio.
