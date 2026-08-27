---
name: metas-faturamento
description: Plano-mestre de inteligência comercial do Coala Shakes — análise de vendas por unidade/produto/hora/dia, leitura de metas do sistema (Meta Alvo + UP), e estratégias de up-sell e cross-sell por unidade. Use para análise comercial, diagnóstico de desempenho/metas, ou estratégias de aumento de vendas. FONTES CORRETAS (não erre): receita = salesReports.items (quantity×unitPrice); custo/margem = productSimulations.grossCost; HORA = productHourlySales (NUNCA item.timestamp); metas = goalPeriods. Regras: operação ≠ venda fraca; lacuna ≠ venda zero; horário fechado ≠ fraco. Linha "Extra" só monitorada.
---

# Plano-mestre de Inteligência Comercial — Coala Shakes

## 0. FONTES DE DADOS (crítico — corrige erros recorrentes)

| Dado | Fonte correta | ⚠️ Erro a evitar |
|---|---|---|
| **Faturamento/receita** | `salesReports.items` → Σ `quantity × unitPrice` | **NÃO** usar `goalPeriods` p/ receita histórica (só tem meses com meta) |
| **Custo / margem / lucro** | `productSimulations.grossCost` via `simulationId` (margem real ~66%). `totalCmv` é o CMV enxuto (margem ~74%) | Não afirmar lucro sem custo |
| **Hora da venda** | `productHourlySales` (produto×hora×qtd) e `hourlySales` (cupons/hora) | **NUNCA** `item.timestamp` — é só o 1º horário do produto no dia → vicia tudo para a manhã |
| **Tickets** | Σ `combos.count` | — |
| **Tickets de 1 item** | `combos` cujo somatório dos `Nx` no nome == 1 | Não usar "ausência de ` + `" (conta "2x" como 1 item) |
| **Meta Alvo / UP** | `goalPeriods.targetValue` / `upValue` / `dailyProgress` / `shifts` | **Nunca fixar meta manual** |
| **Linha do produto** | `productSimulations.lineId` (Extra = `q4ZDQspbymPjSkwwQ150`) | — |
| **Fuso** | horário é **local** (São Luís UTC-3); sem deslocamento | — |

Toda execução: **puxar o dado real via MCP e recalcular.** Os números abaixo (Jan→29/mai/2026) são referência validada, não valores fixos.

## 1. Regras de interpretação (sem exceção)
1. **Unidade sem venda = sem operação** (ex.: Shopping do Automóvel) → fora do comparativo; sem meta comercial.
2. **Matriz = CD** → fora de ranking/ticket/horário/cupons/meta.
3. **Lacuna ≠ venda zero** → dias sem dados são sinalizados; os dias válidos seguem analisados.
4. **Horário fechado ≠ horário fraco** → análise de hora só dentro do expediente.
5. **UP é superação, não base mínima** → meta de gestão é a Meta Alvo.
6. **Desconto não é primeira resposta.**

## 2. Validação obrigatória antes de concluir
Período (datas, dias), cobertura de custo (% do fat com custo), unidades operacionais vs sem operação, lacunas por unidade, existência de `operatingHours` (hoje **não cadastrado** → limitação), metas puxadas do sistema, disponibilidade de linha/custo.

## 3. Dados de referência validados — 01/jan → 29/mai 2026 (149 dias, cobertura de custo 100%)

| Indicador | Valor |
|---|--:|
| Faturamento | R$ 226.666 |
| Itens | 34.024 |
| Tickets | 19.966 |
| Ticket médio | R$ 11,35 |
| Itens/ticket | 1,70 |
| CMV (grossCost) | R$ 76.865 |
| **Lucro bruto** | **R$ 149.802 (margem 66,1%)** |
| Tickets de 1 item | 12.240 (**61,3%**) |

**Por mês:** Jan R$ 46.364 · Fev R$ 43.770 · Mar R$ 44.698 · Abr R$ 47.716 · Mai(29d) R$ 44.118 (estável; tudo estação chuvosa jan–jun).

## 4. Metas do sistema (só Abr–Mai têm meta cadastrada)
| Unidade | Meta Alvo | UP | Abril | Maio(29d) | Leitura |
|---|--:|--:|--:|--:|---|
| Tirirical | R$ 29.000 | R$ 32.000 | R$ 28.402 (97,9%) | R$ 31.382 (**108,2%**) | acima da meta, colado na UP |
| João Paulo | R$ 24.000 | R$ 27.000 | R$ 19.314 (80,5%) | R$ 12.736 (**53,1%**) | muito abaixo — lacuna + fluxo, não ticket |

Explicar sempre o **porquê** (fluxo / ticket / itens-por-cupom / lacuna / mix / operação), nunca só "bateu/não bateu".

## 5. Desempenho e distribuição horária por unidade

### Tirirical — R$ 139.680 (61,6%)
11.882 tickets · ticket R$ 11,76 · 1,74 itens/ticket · **1-item 59,2%** · R$/dia R$ 937 · Casquinha Mista 5.154 / Cascão Misto 3.197 (**conversão cascão 62%**).

| Hora | Receita | % | %prem | | Hora | Receita | % | %prem |
|--:|--:|--:|--:|---|--:|--:|--:|--:|
| 07h | 3.541 | 2,5% | 20% | | 14h | 12.634 | 9,0% | 34% |
| 08h | 6.067 | 4,3% | 25% | | **15h** | 13.558 | 9,7% | 32% |
| 09h | 6.540 | 4,7% | 27% | | **16h** | 13.810 | **9,9%** | 29% |
| 10h | 9.802 | 7,0% | 34% | | **17h** | 13.319 | 9,5% | 29% |
| 11h | 9.914 | 7,1% | 31% | | 18h | 10.014 | 7,2% | 27% |
| 12h | 11.471 | 8,2% | 31% | | 20h | 6.238 | 4,5% | 27% |
| 13h | 12.068 | 8,6% | 34% | | 21h | 4.044 | 2,9% | 23% |

Pico **12h–18h (~54%)**. Fraco real: 7h–9h e 20h–21h.

### João Paulo — R$ 86.986 (38,4%)
8.084 tickets · ticket R$ 10,76 · 1,65 itens/ticket · **1-item 64,4%** · R$/dia R$ 613 · Casquinha Mista 4.777 / Cascão Misto 1.256 (**conversão cascão 26%**) · 7 lacunas em maio (4,6–10,17).

| Hora | Receita | % | %prem | | Hora | Receita | % | %prem |
|--:|--:|--:|--:|---|--:|--:|--:|--:|
| 07h | 1.862 | 2,1% | 30% | | 14h | 8.268 | 9,5% | 30% |
| 08h | 4.298 | 4,9% | 34% | | **15h** | 8.630 | 9,9% | 29% |
| 09h | 5.372 | 6,2% | 32% | | 16h | 8.054 | 9,3% | 32% |
| 10h | 4.823 | 5,5% | 34% | | **17h** | 9.114 | **10,5%** | 33% |
| 11h | 6.040 | 6,9% | 31% | | 18h | 6.231 | 7,2% | 34% |
| 12h | 8.014 | 9,2% | 33% | | 20h | 3.460 | 4,0% | 38% |
| 13h | 8.128 | 9,3% | 35% | | 21h | 1.414 | 1,6% | 33% |

Pico **12h–18h (~56%)**. Fraco real: 6h–8h e 19h–21h.

> **Mito derrubado:** NÃO é "manhã de volume, tarde de valor". O pico é à **tarde (12h–18h)** nas duas, e o **% premium é ~30% estável o dia todo** (não cresce à tarde). Premium é jogo de **vitrine**, não de horário.

## 6. Produtos

**Campeões (não descontar — usar como ponte):**
| Produto | Fat | Qtd | Preço | Margem | LB/un |
|---|--:|--:|--:|--:|--:|
| Casquinha Mista | 42.253 | 9.931 | 4,25 | 64,7% | R$ 2,75 |
| Cascão Misto | 29.205 | 4.453 | 6,56 | 65,7% | R$ 4,31 |
| Casquinha Baunilha | 15.508 | 3.689 | 4,20 | 64,3% | R$ 2,70 |
| Cascão Baunilha | 9.626 | 1.523 | 6,32 | 64,4% | R$ 4,07 |

**Premium (LB R$ 9–14/un, baixo giro — ≈4–5 casquinhas de lucro):** Mix Ovomaltine (357 un, LB R$ 10,91) · Milkshake Ovomaltine (257, R$ 11,97) · Mix Nutella (256, R$ 11,29) · Milkshake Nutella (133, R$ 13,24).

**Baixo giro:** linha SuperSundae/SuperMix (R$ 22, 1–20 un cada em 5 meses) e Bigsundae de sabor. Margem boa (64–67%) → problema é exposição, não preço. Testar vitrine/foto/nome 7 dias antes de cortar; nunca baixar preço primeiro.

## 7. Conversão Cascão/Casquinha por unidade (métrica fixa)
`conversaoCascao = unidadesCascaoMisto / unidadesCasquinhaMista`
- Tirirical: 3.197 / 5.154 = **62%**
- João Paulo: 1.256 / 4.777 = **26%** ← maior gap de up-sell do negócio

## 8. Cesta (combos)
382x Casq Baunilha+Mista · 94x Casq Choc+Mista · 85x Cascão Baunilha+Misto · 68x Cascão Misto+Casq Mista. Quase toda cesta é o **mesmo tipo em sabores diferentes** (compra familiar). **Não existe** cross-sell sorvete→adicional/premium. Combo que gera receita nova = casquinha+adicional e casquinha→cascão (não "casquinha+casquinha", que já acontece sozinho).

## 9. Dia da semana (R$/dia-quiosque)
Sáb 1.168 · Qua 896 · Sex 889 · Qui 773 · Seg 740 · Ter 692 · **Dom 318 (−73% vs sáb)**. Ticket igual (~R$ 11) → domingo é **fluxo**, não valor. (Segunda não é o dia fraco; é domingo.)

## 10. Estratégias de UP-SELL e CROSS-SELL por unidade
Janela de ação das duas: **tarde 12h–18h** (onde estão os clientes). Adicional médio LB ≈ R$ 2,50.

### Tirirical
**Cross-sell — "Complete seu Coala"** (alavanca nº 1 — maior volume de tickets):
| Adesão | Adic./período | +Lucro período | +Lucro/ano |
|--:|--:|--:|--:|
| 10% | 1.188 | +R$ 2.970 | +R$ 7.276 |
| 15% | 1.782 | +R$ 4.455 | +R$ 10.914 |

Principal: Calda Quente (R$ 4 · LB R$ 2,99). Fácil: Cobertura Chocolate (R$ 2 · LB R$ 1,99).
**Up-sell — "Sobe pro Cascão"** (já converte 62%): 10% das 5.154 casq → +515 un → +R$ 804 lucro.
**Metas:** itens/ticket 1,74→1,85; conversão cascão 62%→68%; buscar UP.

### João Paulo
**Up-sell — "Sobe pro Cascão"** (alavanca nº 1 — converte só 26% vs 62%):
| Conversão das 4.777 casq mistas | Un | +Receita | +Lucro |
|--:|--:|--:|--:|
| 10% | 478 | +R$ 1.104 | +R$ 745 |
| 15% | 717 | +R$ 1.656 | +R$ 1.118 |
| 20% | 955 | +R$ 2.206 | +R$ 1.490 |

**Cross-sell — "Complete seu Coala"** (pior 1-item: 64,4% → maior espaço):
| Adesão | Adic./período | +Lucro período | +Lucro/ano |
|--:|--:|--:|--:|
| 10% | 808 | +R$ 2.021 | +R$ 4.950 |
| 15% | 1.213 | +R$ 3.032 | +R$ 7.425 |

Igualar itens/ticket ao Tirirical (1,65→1,74) ≈ +R$ 5 mil/ano. Adicional: Cobertura Chocolate R$ 2.
**Metas:** (1) resolver 7 lacunas; (2) conversão cascão 26%→40%; (3) itens/ticket 1,65→1,74; (4) ticket R$ 10,76→11,50. UP só após normalizar operação.

**Scripts:** *"Por mais R$ 2 leva no cascão, rende bem mais."* · *"Quer deixar com calda quente por mais R$ 4?"* · *"Quer cobertura por mais R$ 2?"*

## 11. Mercadorias — economia dos adicionais (Linha Extra)
**Vendeu só 236 un em 5 meses (Calda Quente: 3) — lucro deixado no balcão.**
| Adicional | Preço | Custo | LB/un | Margem |
|---|--:|--:|--:|--:|
| Cobertura Chocolate | R$ 2 | R$ 0,01 | R$ 1,99 | 99% |
| Granulado | R$ 3 | R$ 0,64 | R$ 2,36 | 79% |
| Ovomaltine | R$ 3 | R$ 0,55 | R$ 2,45 | 82% |
| Calda Quente | R$ 4 | R$ 1,01 | R$ 2,99 | 75% |
| Nutella | R$ 5 | R$ 1,52 | R$ 3,48 | 70% |

Linha Extra é **monitorada normalmente**; só vira recomendação se os dados mostrarem relevância. (Aqui, a relevância é o **não-uso** — daí a estratégia de cross-sell.)

## 12. O que NÃO fazer
Não descontar Casquinha/Cascão Misto · não chamar unidade sem operação de "fraca" · não tratar lacuna como venda zero · não comparar JP×Tirirical sem separar lacunas · **não classificar 18h–21h como fraco sem cadastrar expediente** · não empurrar milkshake no pico (13h–17h) · não criar combo "casquinha+casquinha" · não baixar preço de premium antes de vitrine · não fixar meta manual.

## 13. Fórmulas
```ts
faturamento       = Σ(item.quantity * item.unitPrice)         // salesReports.items
cmv               = Σ(item.quantity * sim.grossCost)          // via simulationId
margem            = (faturamento - cmv) / faturamento
ticketMedio       = faturamento / tickets                     // tickets = Σ combos.count
itensPorTicket    = itens / tickets
conversaoCascao   = qtdCascaoMisto / qtdCasquinhaMista
percentualMeta    = realizado / metaAlvoSistema               // meta vem do goalPeriods
faltanteMeta      = metaAlvoSistema - realizado
mediaDiariaValida = realizado / diasValidos
projecao          = mediaDiariaValida * diasOperacionaisPrevistos
// HORA: sempre productHourlySales[sid][hora] * unitPrice — nunca item.timestamp
```

## 14. Plano de acompanhamento
**7 dias:** cadastrar `operatingHours`; investigar as 7 lacunas de maio do JP; iniciar teste "Complete seu Coala" no JP (tarde 12h–18h, Cobertura R$ 2 + Calda R$ 4); medir adicionais/cupom e itens/ticket.
**30 dias:** se adesão ≥ 15% sem travar fila, estender ao Tirirical; implantar "Sobe pro Cascão" (foco JP); vitrine premium nas bordas do pico; reavaliar metas de junho (Tir↑, JP condicionado).
**Indicadores:** itens/ticket (→≥1,85 Tir / 1,74 JP), %1-item (↓), adicionais/cupom, conversão cascão (Tir→68% / JP→40%), R$/dia domingo, lacunas (→0).

## 15. Resumo executivo
1. **Maior problema:** 61,3% dos tickets com 1 item; adicionais quase não oferecidos (236 un/5m).
2. **Maior oportunidade:** cross-sell de adicional (+R$ 12–24 mil/ano de lucro, margem 70–99%, sem desconto).
3. **Mercadoria p/ atacar 1º:** Calda Quente (LB R$ 2,99) / Cobertura Chocolate (LB R$ 1,99).
4. **Unidade p/ testar 1º:** João Paulo (1-item 64,4%, maior espaço).
5. **Correção operacional:** João Paulo (7 lacunas + queda de fluxo).
6. **Meta mais confortável:** Tirirical (108% em maio). **Mais distante:** João Paulo (53%).
7. **Campeão sem desconto:** Casquinha Mista. **Premium destaque:** Mix Ovomaltine / Milkshake Nutella.
8. **Baixo giro a revisar:** linha SuperSundae/SuperMix R$ 22.
9. **Up-sell decisivo:** João Paulo converte só 26% das casquinhas em cascão (vs 62% Tirirical) — fechar esse gap é o maior ganho estrutural.
10. **Horário:** pico real 12h–18h nas duas; premium ~30% o dia todo; horas fracas reais = início da manhã e fim de noite.
