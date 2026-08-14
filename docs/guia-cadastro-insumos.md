# Guia Completo de Cadastro de Insumos

> **Para quem é este guia?**
> Para qualquer pessoa responsável por cadastrar ou revisar insumos no sistema — compras, estoque, almoxarifado ou TI. O objetivo é que, ao terminar de ler, você entenda não apenas *o que* preencher, mas *por que* cada campo existe e *o que acontece* quando você preenche errado.

---

## Sumário

1. [Por que existe essa hierarquia?](#1-por-que-existe-essa-hierarquia)
2. [Visão geral dos três níveis](#2-visão-geral-dos-três-níveis)
3. [Categorias e Unidades de Medida — A base de tudo](#3-categorias-e-unidades-de-medida--a-base-de-tudo)
4. [Nível 1 — Insumo Base: como cadastrar](#4-nível-1--insumo-base-como-cadastrar)
5. [Nível 2 — Insumo Derivado: como cadastrar](#5-nível-2--insumo-derivado-como-cadastrar)
6. [Nível 3 — Lote: como cadastrar](#6-nível-3--lote-como-cadastrar)
7. [A fórmula de conversão explicada](#7-a-fórmula-de-conversão-explicada)
8. [O que NUNCA fazer ao cadastrar](#8-o-que-nunca-fazer-ao-cadastrar)
9. [Exemplos de uma operação real — do início ao fim](#9-exemplos-de-uma-operação-real--do-início-ao-fim)
---

## 1. Por que existe essa hierarquia?

Imagine que você compra **Leite Integral**. Às vezes você compra em caixinha de 1L, às vezes em sachê de 200ml, às vezes em caixa com 27 sachês. São três formas diferentes de comprar **a mesma coisa**.

O problema é que, para o estoque, você precisa saber: **ao todo, quantos litros de leite integral eu tenho?** Você não pode somar 2 caixinhas + 5 sachês diretamente — as unidades são diferentes.

A hierarquia resolve isso criando três camadas:

```
┌─────────────────────────────────────────────────────────┐
│  INSUMO BASE — "o que é e em qual unidade padronizamos" │
│  Ex.: Leite Integral → medido em litros (l)              │
└────────────────────────┬────────────────────────────────┘
                         │ um Insumo Base pode ter
                         │ vários Insumos Derivados
                         ▼
┌─────────────────────────────────────────────────────────┐
│  INSUMO DERIVADO — "como esse insumo é embalado/vendido"│
│  Ex.: Caixinha 1L · Sachê 200ml · Caixa c/27 Sachês    │
└────────────────────────┬────────────────────────────────┘
                         │ cada Derivado pode ter
                         │ vários Lotes
                         ▼
┌─────────────────────────────────────────────────────────┐
│  LOTE — "a entrada física real no estoque"              │
│  Ex.: 48 caixinhas · Lote L2026-05 · Validade 2027-01  │
└─────────────────────────────────────────────────────────┘
```

**O Insumo Base é o coração.** Ele diz ao sistema qual é a unidade de referência para tudo. Todos os cálculos de custo (R$/unidade base), relatórios de consumo e alertas de estoque mínimo usam a unidade do Insumo Base como moeda comum.

**O Insumo Derivado é a ponte.** Ele descreve uma embalagem comercial e informa ao sistema "cada unidade minha equivale a X unidades do Insumo Base". Essa é a informação que permite comparar coisas compradas em formatos diferentes.

**O Lote é a realidade física.** É o registro que efetivamente aumenta o estoque. Está amarrado a um Insumo Derivado (então o sistema sabe a equivalência em base), a um local e a uma data de validade.

---

## 2. Visão geral dos três níveis

Antes de entrar campo a campo, veja o mapa mental de como os três níveis se relacionam em uma operação real:

**Cenário:** Uma padaria industrial usa Farinha de Trigo. Ela é comprada de dois fornecedores — um entrega em sacos de 25kg, o outro em sacos de 50kg. No inventário, a equipe conta em quilos.

| O que cadastrar | Nível | O que define |
|---|---|---|
| Farinha de Trigo | **Insumo Base** | Categoria: Massa, Unidade: kg |
| Farinha de Trigo 25kg Saco | **Insumo Derivado** | packageSize: 25, unit: kg |
| Farinha de Trigo 50kg Saco | **Insumo Derivado** | packageSize: 50, unit: kg |
| 10 sacos recebidos do Fornecedor A | **Lote** | Derivado: 25kg, Qtd: 10 → sistema sabe = 250 kg |
| 5 sacos recebidos do Fornecedor B | **Lote** | Derivado: 50kg, Qtd: 5 → sistema sabe = 250 kg |

Resultado: o sistema consegue dizer "você tem 500 kg de Farinha de Trigo" — mesmo que esses 500 kg estejam em sacos de tamanhos diferentes, de fornecedores diferentes, recebidos em datas diferentes.

---

## 3. Categorias e Unidades de Medida — A base de tudo

Este é o conceito mais importante do sistema inteiro. **Se você errar aqui, toda a cadeia fica errada e as conversões falham silenciosamente ou exibem erros na hora da compra.**

### O que é uma Categoria?

Uma Categoria é a família de grandezas físicas de um insumo. Litros e mililitros são da família Volume. Quilogramas e gramas são da família Massa. Não existe conversão entre famílias diferentes — você não pode transformar litros em quilogramas sem uma fórmula específica para cada líquido, e o sistema não tem essa informação.

### As 5 categorias disponíveis

---

#### Categoria: **Volume**

**Para quê:** qualquer insumo medido em quantidade de líquido ou fluido.

**Unidade base interna:** litro (`l`)

| Unidade | Símbolo | Equivale em litros | Quando usar |
|---|---|---|---|
| Litro | `l` | 1,000 l | Insumo base de líquidos grandes (óleos, vinagres, álcool, xaropes) |
| Mililitro | `ml` | 0,001 l | Derivados em embalagens pequenas (sachês de molho, frascos pequenos) |
| Bag | `bag` | 1,000 l (padrão) | Bag-in-box; o valor real é definido pelo packageSize do derivado |

**Exemplos de insumos nessa categoria:**
- Óleo de Soja (base: `l`)
- Álcool Gel 70% (base: `l`)
- Vinagre de Álcool (base: `l`)
- Leite Integral fluido — **atenção: leite fluido é Volume, leite em pó é Massa**
- Refrigerante concentrado (base: `l`)

**Conversão automática entre unidades de Volume:**
```
500 ml  →  0,500 l    (500 × 0,001 = 0,500)
2 l     →  2.000 ml   (2 × 1 / 0,001 = 2.000)
```

---

#### Categoria: **Massa**

**Para quê:** qualquer insumo medido em peso.

**Unidade base interna:** quilograma (`kg`)

| Unidade | Símbolo | Equivale em kg | Quando usar |
|---|---|---|---|
| Quilograma | `kg` | 1,000 kg | Insumo base de sólidos (farinhas, açúcar, sal, carne) |
| Grama | `g` | 0,001 kg | Derivados em embalagens pequenas (sachês de 30g, pacotinhos) |
| Miligrama | `mg` | 0,000001 kg | Insumos químicos ou farmacêuticos; raramente usado em alimentos |

**Exemplos de insumos nessa categoria:**
- Farinha de Trigo (base: `kg`)
- Açúcar Cristal (base: `kg`)
- Leite em Pó (base: `kg`)
- Chocolate em Pó (base: `kg`)
- Café Torrado e Moído (base: `kg`)
- Sal Refinado (base: `kg`)
- Carne Bovina (base: `kg`)

**Conversão automática entre unidades de Massa:**
```
400 g   →  0,400 kg   (400 × 0,001 = 0,400)
1,5 kg  →  1.500 g    (1,5 × 1 / 0,001 = 1.500)
250 mg  →  0,00025 kg (250 × 0,000001 = 0,00025)
```

---

#### Categoria: **Unidade**

**Para quê:** insumos contados por peça, onde não faz sentido medir em massa ou volume.

**Unidade base interna:** unidade (`un`) — todas as unidades aqui valem 1. Não há conversão de escala.

| Unidade | Símbolo | Equivale | Quando usar |
|---|---|---|---|
| Unidade | `un` ou `unidade` | 1 | Item contado individualmente (ovo, pão de forma, copo descartável) |
| Pacote | `pacote` | 1 | Quando a embalagem comercial já é referida como "pacote" |
| Bag | `bag` | 1 | Quando a embalagem é um bag sem relação de volume |
| Caixa | `caixa` | 1 | Quando a caixa é a unidade de contagem (ex: caixa de fósforo) |

> **Atenção importante:** nessa categoria, todas as unidades valem 1. Isso significa que o sistema **não converte automaticamente** entre elas. A conversão real fica por conta do `packageSize` do Insumo Derivado. Por isso, quando o Insumo Base usa `un`, o Derivado também deve usar `un` e o `packageSize` deve refletir quantas unidades individuais existem por embalagem.

**Exemplos de insumos nessa categoria:**
- Ovo de Galinha (base: `un` — o ovo é a unidade mínima)
- Copo Descartável 200ml (base: `un`)
- Luva Nitrílica descartável (base: `un` — cada luva é uma unidade)
- Guardanapo (base: `un`)
- Palito de Dente (base: `un`)
- Saco de Lixo (base: `un`)

---

#### Categoria: **Embalagem**

**Para quê:** materiais cuja unidade de controle é a própria embalagem como objeto, não o que ela contém.

**Unidade base interna:** unidade (`un`) — mesma lógica da categoria Unidade.

| Unidade | Símbolo | Equivale | Quando usar |
|---|---|---|---|
| Unidade | `un` ou `unidade` | 1 | Embalagem individual (pote, caixinha, frasco) |
| Pacote | `pacote` | 1 | Conjunto de embalagens menor que uma caixa logística |
| Bag | `bag` | 1 | Bag como embalagem final |
| Caixa | `caixa` | 1 | Caixa como embalagem final do produto |

**Diferença entre Unidade e Embalagem na prática:**
- Use **Unidade** quando o insumo é uma peça funcional (ovo, luva, guardanapo).
- Use **Embalagem** quando o insumo é o próprio recipiente (pote de condimento para delivery, caixinha para sobremesa, embalagem de sacola).

**Exemplos de insumos nessa categoria:**
- Pote de Sobremesa 100ml (a embalagem descartável, não o produto dentro)
- Sacola Kraft para Delivery
- Tampa de Copo 200ml
- Caixinha de Suco 200ml (a embalagem, não o suco — o suco seria Volume)

---

#### Categoria: **Vestimenta**

**Para quê:** exclusivamente para uniformes, EPIs têxteis e itens de vestuário.

**Unidade base interna:** peça (`peça`) — todas as unidades valem 1.

| Unidade | Símbolo | Equivale | Quando usar |
|---|---|---|---|
| Peça | `peça` | 1 | Padrão para qualquer item de vestuário |
| Unidade | `un` ou `unidade` | 1 | Alternativo, aceito pelo sistema |

> **Comportamento especial:** Ao selecionar a categoria **Vestimenta**, o sistema automaticamente define Tipo de Embalagem como `Unidade`, Tamanho como `1` e desabilita a unidade logística. Cada peça de roupa é sempre 1 peça, sem exceção.

**Campos exclusivos dessa categoria no Insumo Derivado:**
- Tipo de Vestimenta (ex.: `Camiseta`, `Calça`, `Avental`, `Touca`)
- Tamanho (ex.: `P`, `M`, `G`, `GG`, `44`, `38`)
- Cor (ex.: `Branco`, `Preto`, `Azul Marinho`)
- Modelagem (ex.: `Masculino`, `Feminino`, `Unissex`)

**Exemplos de insumos nessa categoria:**
- Camiseta Polo Uniforme (base: `peça`)
- Avental de Cozinha (base: `peça`)
- Touca Descartável — atenção: se for caixa com 100 toucas, considere usar **Unidade** no base e o derivado representa a caixa com `packageSize: 100`

---

### Tabela de referência rápida: qual **Categoria da unidade** usar?

> Esta tabela aplica-se ao campo `Categoria da unidade` (Seção 3 do Derivado e campo único do Insumo Base). Não confunda com a `Categoria do item` (Seção 7 do Derivado), que classifica operacionalmente e é independente desta escolha.

| Pergunta | Resposta |
|---|---|
| Eu meço esse insumo em litros ou mililitros? | **Volume** |
| Eu peso esse insumo em kg ou gramas? | **Massa** |
| Eu conto esse insumo por peça individual (ovo, luva, copo)? | **Unidade** |
| O insumo é uma embalagem/recipiente descartável em si? | **Embalagem** |
| O insumo é uma roupa, uniforme ou EPI têxtil? | **Vestimenta** |

---

### Onde cada campo de "categoria" existe na hierarquia?

Este ponto gera muita confusão. Existem **três campos relacionados a categoria** no sistema, e eles vivem em níveis e seções diferentes do formulário:

| Campo | Existe no Insumo Base? | Existe no Insumo Derivado? | O que faz |
|---|---|---|---|
| **Categoria da unidade** (`category`) | ✅ Sim | ✅ Sim (Seção 3) | Define a família de grandeza (Volume, Massa, etc.) e controla quais unidades ficam disponíveis. **No Derivado, deve ser idêntica à do Base vinculado.** |
| **Tipo de Embalagem** (`packageType`) | ❌ Não | ✅ Sim (Seção 3) | Descreve a forma física da embalagem comercial (Caixa, Frasco, Sachê, etc.). É informativo — não afeta conversões. |
| **Categoria do item** (`operationalCategoryId`) | ❌ Não | ✅ Sim (Seção 7) | Classifica operacionalmente o Derivado (ex.: Insumo, Material de Limpeza, Vestimenta). Define como o item é tratado nas compras e no recebimento. |

> **Regra de ouro:** quando o sistema ou o usuário diz "categoria" sem qualificador, o contexto define qual das duas categorias do Derivado está em jogo: se o assunto for unidades de medida e conversão → é a `Categoria da unidade`; se o assunto for fluxo de compras e tratamento operacional → é a `Categoria do item`.

**O Insumo Base não tem Tipo de Embalagem nem Categoria do item.** Faz sentido: o ingrediente em si não tem embalagem e não precisa de classificação operacional — essas são características do produto comercial (Derivado), não do conceito genérico (Base).

**Resumo visual:**

```
Insumo Base "Leite em Pó"
  ├── category: Massa               ← categoria da unidade (existe aqui)
  └── unit: kg                      ← existe aqui
      (sem packageType, sem operationalCategoryId)

Insumo Derivado "Leite em Pó Ninho 400g Sachê"
  ├── category: Massa               ← categoria da unidade (Seção 3 — deve igualar o Base)
  ├── unit: g                       ← unidade do conteúdo desta embalagem
  ├── packageSize: 400              ← quantidade de conteúdo por embalagem
  ├── packageType: Sachê            ← forma física da embalagem (Seção 3)
  └── operationalCategoryId: ...   ← categoria do item — ex.: "Insumo" (Seção 7)
```

---

## 4. Nível 1 — Insumo Base: como cadastrar

O Insumo Base é o mestre. Ele existe para ter **um único ponto de referência** por ingrediente, independente de quantas formas esse ingrediente seja comprado. Pense nele como a entrada no glossário do seu estoque: define o nome canônico e a unidade de referência.

**Como acessar:** Menu lateral → Configurações → Operacional → Cadastros → aba "Insumo base" → botão "Novo produto base"

> 📸 **[Screenshot: modal aberto — visão geral do formulário de Insumo Base]**

O formulário é simples — seis campos e uma tabela. Não há foto, não há tipo de embalagem. O Insumo Base é conceitual, não físico.

---

### Campo 1 — Nome do produto base

> 📸 **[Screenshot: campo "Nome do produto base" em destaque]**

**Rótulo na tela:** `Nome do produto base`
**Placeholder de exemplo:** `ex: Ovomaltine (Pó)`
**Obrigatório:** sim

O nome genérico e canônico do insumo. Sem marca, sem tamanho, sem tipo de embalagem — apenas o ingrediente.

| Correto ✅ | Errado ❌ | Por quê está errado |
|---|---|---|
| `Leite em Pó` | `Leite em Pó Ninho 400g` | Marca e tamanho vão no Derivado |
| `Óleo de Soja` | `Óleo de Soja Liza` | Marca vai no Derivado |
| `Café Torrado e Moído` | `Café` | Vago demais — diferente de café solúvel |
| `Álcool Gel 70%` | `Álcool Gel 70% Frasco 500ml` | "Frasco 500ml" é embalagem — vai no Derivado |
| `Copo Descartável 200ml` | `COPO DESCARTAVEL` | A concentração/tamanho faz parte do nome do insumo neste caso |

**Dica:** pergunte-se *"se eu trocar de fornecedor amanhã, esse nome ainda faz sentido?"* Se sim, está correto.

---

### Campo 2 — Classificação (opcional)

> 📸 **[Screenshot: campo "Classificação" com dropdown aberto mostrando as opções]**

**Rótulo na tela:** `Classificação (opcional)`
**Obrigatório:** não
**Tipo:** select (lista de classificações cadastradas) + botão de engrenagem ⚙️

Agrupamento livre para organizar os insumos em categorias operacionais ou contábeis. Serve para filtrar listas e gerar relatórios por grupo.

**Exemplos:** `Laticínios`, `Grãos e Farinhas`, `Descartáveis`, `EPI`, `Limpeza`, `Higiene`, `Bebidas`, `Uniformes`

**O botão ⚙️ ao lado:** abre o gerenciador de classificações, onde você cria e edita os grupos disponíveis. Se a classificação que você precisa não existir, clique neste botão para criar antes de continuar.

> **Não confunda** Classificação (organizacional, você define) com Categoria (técnica, controla as unidades de medida). São coisas diferentes.

---

### Campos 3 e 4 — Categoria da unidade + Unidade de medida padrão

> 📸 **[Screenshot: os dois selects lado a lado — "Categoria da unidade" e "Unidade de medida padrão"]**

**Rótulos na tela:** `Categoria da unidade` | `Unidade de medida padrão`
**Obrigatório:** sim (ambos)
**Comportamento:** ao mudar a Categoria, a Unidade é redefinida automaticamente para a primeira opção disponível naquela categoria.

Estes dois campos juntos definem **a régua de medida de todo o insumo**. Todos os Derivados vinculados e todos os cálculos de custo e estoque usam essa unidade como referência.

**Opções disponíveis por categoria:**

| Categoria | Unidades disponíveis | Recomendação padrão |
|---|---|---|
| `Volume` | `l`, `ml`, `bag` | Use `l` — estoque fica legível (ex: "45 l") |
| `Massa` | `kg`, `g`, `mg` | Use `kg` — estoque fica legível (ex: "12 kg") |
| `Unidade` | `un`, `pacote`, `bag`, `caixa` | Use `un` |
| `Embalagem` | `un`, `pacote`, `bag`, `caixa` | Use `un` |
| `Vestimenta` | `peça`, `un` | Use `peça` |

**Regra crítica:** a Categoria escolhida aqui **deve ser idêntica** à Categoria de todos os Insumos Derivados que você vincular a este Base. Se as categorias forem diferentes, a conversão falha na hora da compra.

**Pergunta para escolher a categoria certa:**
- Eu meço em litros/mililitros? → `Volume`
- Eu peso em kg/gramas? → `Massa`
- Eu conto por peça (ovo, copo, luva)? → `Unidade`
- O insumo é uma embalagem/recipiente descartável? → `Embalagem`
- É roupa ou EPI têxtil? → `Vestimenta`

---

### Campo 5 — Custo por Unidade (somente leitura)

> 📸 **[Screenshot: campo "Custo por Unidade" desabilitado com ícone de cadeado/cifrão]**

**Rótulo na tela:** `Custo por Unidade`
**Editável:** não — campo bloqueado (fundo cinza)
**Descrição exibida:** *"O custo por unidade é definido automaticamente na confirmação da compra."*

Este campo é preenchido automaticamente pelo sistema quando uma compra é confirmada no módulo de Recebimento de Compra. Ele mostra o custo do **último lote confirmado** por unidade base (ex.: R$/kg, R$/l, R$/un) — não é uma média ponderada.

**Como interpretar:** se você recebeu dois lotes de Leite em Pó com custos diferentes, o campo mostrará o custo do lote confirmado mais recentemente. O histórico completo de preços fica disponível no próprio Insumo Base, e o custo correto de cada lote individual é rastreado no momento da confirmação da compra.

**Você não deve e não consegue editar este campo.** Ele está aqui apenas para consulta.

---

### Campo 6 — Sugerir Pedido para (meses)

> 📸 **[Screenshot: campo "Sugerir Pedido para (meses)" com ícone de calendário]**

**Rótulo na tela:** `Sugerir Pedido para (meses)`
**Placeholder:** `Ex: 2`
**Obrigatório:** não

Quantos meses de consumo histórico o sistema deve considerar ao calcular a sugestão de quantidade para o próximo pedido.

**Exemplo:** `3` → o sistema analisa os últimos 3 meses de consumo e sugere pedir a quantidade equivalente ao consumo médio desse período.

**Quando preencher:** para insumos com consumo regular e previsível.
**Quando deixar vazio:** para insumos esporádicos, sazonais ou de consumo muito variável.

---

### Seção 7 — Parâmetros por quiosque (opcional)

> 📸 **[Screenshot: tabela de parâmetros por quiosque com colunas Estoque Mínimo, Estoque Segurança, Lead Time]**

**Título na tela:** `Parâmetros por quiosque (opcional)`
**Tipo:** tabela com uma linha por quiosque cadastrado

Esta tabela permite configurar parâmetros de controle de estoque individualmente para cada local operacional. Um Insumo Base pode ter limites diferentes no Almoxarifado Central e na Cozinha da Filial, por exemplo.

**Colunas:**

**Quiosque** — nome do local (preenchido automaticamente, não editável).

**Estoque Mínimo** — a quantidade, na unidade padrão do Base, abaixo da qual o sistema gera um alerta de reposição.
- Exemplo: `Leite Integral` no kiosk `Cozinha` com mínimo `20` (litros) → alerta quando o estoque cair abaixo de 20 l.

**Estoque de Segurança** — uma reserva extra acima do mínimo, para absorver atrasos de entrega ou picos inesperados de consumo. Na prática, é uma margem de segurança: o pedido de reposição é disparado quando o estoque atinge `Mínimo + Segurança`.
- Exemplo: `5` → o sistema age como se o mínimo real fosse 25 l (20 mínimo + 5 segurança).

**Lead Time (dias)** — quantos dias o fornecedor leva para entregar após o pedido. Usado para calcular com quantos dias de antecedência o pedido precisa ser feito.
- Exemplo: `3` → o pedido deve ser feito 3 dias antes de o estoque atingir o mínimo.

**Como preencher:** informe os valores nas colunas correspondentes a cada quiosque. Deixe `0` (ou vazio) nos quiosques onde este insumo não é controlado.

---

### Salvando o Insumo Base

> 📸 **[Screenshot: botão "Adicionar produto" no rodapé do modal]**

Clique em **"Adicionar produto"** (novo) ou **"Salvar alterações"** (edição). O sistema valida se o nome e a unidade foram preenchidos antes de salvar.

---

## 5. Nível 2 — Insumo Derivado: como cadastrar

O Insumo Derivado representa uma **apresentação comercial específica** de um Insumo Base. É o produto que aparece na nota fiscal — com marca, tamanho e embalagem definidos.

**Por que vincular ao Insumo Base?**
Porque sem essa vinculação, o sistema não consegue calcular o custo por unidade base (R$/kg, R$/l), nem consolidar o estoque total de um ingrediente comprado em formatos ou marcas diferentes. Um Derivado sem vínculo funciona para controle de lotes, mas fica invisível para custeio e consolidação.

**Como acessar:** Menu lateral → Configurações → Operacional → Cadastros → aba "Insumo derivado" → botão "Adicionar insumo"

> 📸 **[Screenshot: modal aberto — visão geral do formulário de Insumo Derivado com os cards coloridos visíveis]**

O formulário é dividido em seções (cards coloridos). Siga a ordem de cima para baixo.

---

### Seção 1 — Foto do insumo (card azul)

> 📸 **[Screenshot: seção "Foto do insumo" com placeholder de câmera e os botões "Tirar foto" e "Upload"]**

A primeira seção do formulário é dedicada à foto do produto. Ela serve para identificação visual rápida no inventário e nas listagens.

**Opções:**

**"Tirar foto"** — abre a câmera do dispositivo para capturar uma foto em tempo real. Use quando o produto estiver à sua frente.

**"Upload"** — abre o seletor de arquivos para enviar uma imagem já salva no computador ou celular. Aceita qualquer imagem até **5MB**.

**"Remover"** (botão vermelho) — aparece somente quando já há uma foto carregada. Remove a imagem atual.

> Limite de arquivo: **5MB**. Imagens maiores são rejeitadas com mensagem de erro.

---

### Seção 2 — Informações básicas (card azul)

> 📸 **[Screenshot: seção "Informações básicas" com campos Nome do insumo, Marca e Código de barras]**

#### Campo: Nome do insumo

**Rótulo na tela:** `Nome do insumo`
**Placeholder:** `ex: Ovomaltine`
**Obrigatório:** sim

O nome completo do produto comercial. Inclua aqui a marca, o tamanho e o tipo de embalagem — é isso que diferencia este Derivado dos outros vinculados ao mesmo Insumo Base.

**Formato recomendado:** `[Ingrediente] [Marca] [Tamanho] [Tipo de Embalagem]`

| Correto ✅ | Errado ❌ |
|---|---|
| `Leite em Pó Ninho 400g Sachê` | `Leite em Pó` (vago — isso vai no Base) |
| `Óleo de Soja Liza 900ml Garrafa` | `Óleo` (genérico demais) |
| `Copo Descartável 200ml Pct c/100` | `Copo 200ml` (sem embalagem/quantidade) |

#### Campo: Marca

**Rótulo na tela:** `Marca`
**Placeholder:** `ex: Nestlé`
**Obrigatório:** não

O fabricante ou marca comercial do produto. Preencha sempre — facilita a busca em listas longas e permite comparar custo entre marcas no mesmo Insumo Base.

#### Campo: Código de barras

**Rótulo na tela:** `Código de barras`
**Placeholder:** `Escanear ou digitar`
**Obrigatório:** não

O EAN-13 ou outro código impresso na embalagem física. Pode ser digitado manualmente ou lido pela câmera — clique no ícone de câmera 📷 ao lado do campo para abrir o leitor de código de barras.

Preencha sempre que sua operação usar leitores na entrada de estoque ou inventário.

---

### Seção 3 — Embalagem de conteúdo (card âmbar/amarelo) ⚠️ A mais crítica

> 📸 **[Screenshot: seção "Embalagem de conteúdo" com os campos Tipo de embalagem, Categoria, Qtd. embalagem e Unidade]**

Esta seção define **a conversão entre o Derivado e o Insumo Base**. Erros aqui resultam em custo incorreto e estoque errado.

A descrição na tela diz: *"Detalhes do item físico que você compra. Ex: um pacote de 500g, uma lata de 395g, etc."*

#### Campo: Tipo de embalagem

**Rótulo na tela:** `Tipo de embalagem`
**Obrigatório:** sim

A forma física da embalagem. Não afeta os cálculos — é descritivo e aparece nos relatórios.

| Tipo | Exemplos de produto |
|---|---|
| `Unidade` | Item avulso sem embalagem específica |
| `Caixa` | Caixas de papelão, caixinhas de leite |
| `Pacote` | Pacotes plásticos selados (farinha, açúcar, café) |
| `Lata` | Extrato de tomate, leite condensado, manteiga |
| `Garrafa` | Óleo, azeite, vinagre (plástico ou vidro) |
| `Frasco` | Ketchup, maionese, álcool gel, molhos |
| `Sachê` | Monodoses de condimento, adoçante, leite em pó |
| `Pote` | Iogurte, requeijão, margarina, geleia |
| `Balde` | Maionese 3,5kg, amaciante, gordura vegetal |
| `Galão` | Água 5L, álcool, detergente grande |
| `Bag` | Bag-in-box (vinhos, polpas, bases prontas) |

#### Campo: Categoria

**Rótulo na tela:** `Categoria`
**Obrigatório:** sim
**Regra rígida:** deve ser **idêntica** à categoria do Insumo Base vinculado

> **Nota de nomenclatura:** neste guia, este campo é chamado de `Categoria da unidade` sempre que for necessário distingui-lo da `Categoria do item` (Seção 7). Na tela do formulário, o rótulo é simplesmente `Categoria`.

Este campo define a família de grandeza do **conteúdo** da embalagem. A opção `Embalagem` existe especificamente para quando o próprio Derivado **é** uma embalagem descartável — ou seja, o que você compra e controla no estoque é o recipiente em si, não o que vai dentro dele.

| Se o Derivado é... | Categoria correta |
|---|---|
| Garrafa de Óleo 900ml (você controla litros de óleo) | `Volume` |
| Pacote de Farinha 5kg (você controla kg de farinha) | `Massa` |
| Caixa com 100 copos (você controla copos como peça) | `Unidade` |
| Pote descartável para delivery (o pote é o produto) | **`Embalagem`** |
| Sacola Kraft (a sacola é o produto) | **`Embalagem`** |
| Camiseta de uniforme (a peça é o produto) | `Vestimenta` |

Se você selecionar um Insumo Base e a categoria deste Derivado for diferente, o sistema exibe um **alerta vermelho** e bloqueia o salvamento.

> **Comportamento especial para Vestimenta:** ao selecionar esta categoria, o sistema automaticamente define Tipo de embalagem como `Unidade`, Quantidade como `1` e desabilita a seção de logística. Roupas são sempre 1 peça.

#### Campo: Qtd. embalagem ⚠️

**Rótulo na tela:** `Qtd. embalagem`
**Obrigatório:** sim — mínimo `0,001`
**Tooltip na tela:** *"Informe o conteúdo da embalagem. Ex: para 400g, digite 400."*

**Este é o campo mais importante do cadastro do Derivado.** Ele informa ao sistema *quanto do Insumo Base existe dentro de uma unidade deste Derivado*.

| Se o produto é... | Qtd. embalagem | Unidade |
|---|---|---|
| Sachê de Leite em Pó 400g | `400` | `g` |
| Garrafa de Óleo de Soja 900ml | `900` | `ml` |
| Saco de Farinha de Trigo 5kg | `5` | `kg` |
| Copo Descartável (avulso) | `1` | `un` |
| Caixa com 100 copos | `100` | `un` |
| Frasco de Álcool Gel 500ml | `500` | `ml` |

**Erro frequente:** confundir o conteúdo da embalagem com a quantidade de embalagens recebidas. Se chegaram 24 frascos de 500ml, a Qtd. embalagem é `500` (ml por frasco) — o `24` vai no Lote ou na Unidade Logística.

#### Campo: Unidade

**Rótulo na tela:** `Unidade`
**Obrigatório:** sim
**Opções:** dependem da Categoria selecionada

A unidade do número informado em "Qtd. embalagem". Deve pertencer à mesma categoria do Insumo Base.

| Categoria | Unidades disponíveis | Use para o Derivado |
|---|---|---|
| `Volume` | `l`, `ml`, `bag` | `ml` para embalagens pequenas, `l` para grandes |
| `Massa` | `kg`, `g`, `mg` | `g` para embalagens pequenas, `kg` para grandes |
| `Unidade` | `un`, `pacote`, `bag`, `caixa` | `un` na maioria dos casos |
| `Embalagem` | `un`, `pacote`, `bag`, `caixa` | `un` na maioria dos casos |
| `Vestimenta` | `peça`, `un` | `peça` |

**A conversão automática funciona assim:**
```
Sachê 400g com Base em kg:
  400 g × 0,001 = 0,400 kg por sachê

Frasco 900ml com Base em l:
  900 ml × 0,001 = 0,900 l por frasco

Saco 5kg com Base em kg:
  5 kg × 1 = 5,000 kg por saco
```

---

### Seção 4 — Detalhes logísticos (card azul, ativado por switch)

> 📸 **[Screenshot: seção "Detalhes logísticos" com o switch desligado]**
> 📸 **[Screenshot: seção "Detalhes logísticos" com o switch ligado e os campos Quantidade e Tipo de agrupamento visíveis]**

**Rótulo:** `Detalhes logísticos` / `Embalagem de agrupamento`
**Ativação:** switch (desligado por padrão)

Habilite esta seção quando o fornecedor entrega em caixas que agrupam várias unidades do Derivado. Com ela ativa, você pode registrar compras em "Caixas" ao invés de unidades individuais.

#### Campo: Quantidade (quando logística ativa)

**Rótulo na tela:** `Quantidade`
**Placeholder:** `Ex: 12`
**Descrição na tela:** *"Informe quantas unidades do insumo de compra (ex: bags, latas, pacotes) cabem dentro da embalagem de agrupamento. Exemplo: se 1 'Caixa' contém 10 'Bags', insira '10'."*

Quantas unidades do Derivado existem dentro de uma embalagem logística (caixa, fardo, pallet).

**Exemplo:** Derivado é `Frasco 500ml` e o fornecedor entrega em caixas com 12 frascos → Quantidade = `12`

#### Campo: Tipo de agrupamento (quando logística ativa)

**Rótulo na tela:** `Tipo de agrupamento`
**Opções disponíveis:** `Caixa`, `Fardo`, `Pallet`, `Tambor`

Como a embalagem logística é chamada. Essa palavra aparece no formulário de compra para o usuário escolher entre "comprar por Frasco" ou "comprar por Caixa".

**Exemplo completo:**
```
Derivado: Álcool Gel 500ml Frasco
  Qtd. embalagem: 500 ml
  Logística ativa: sim
    Quantidade: 12
    Tipo: Caixa

Na compra, o usuário pode informar:
  • "Comprei 24 Frascos" → sistema registra 12 l
  • "Comprei 2 Caixas"   → sistema registra 12 l (mesmo resultado)
```

---

### Seção 5 — Unidade Padrão para Contagem (card verde)

> 📸 **[Screenshot: seção "Unidade Padrão para Contagem" com o select aberto mostrando as três opções]**

**Rótulo:** `Unidade Padrão para Contagem`
**Descrição na tela:** *"Define como este insumo será exibido e contado no módulo de contagem de estoque."*

| Opção na tela | Código | Quando usar |
|---|---|---|
| `Unidade do Lote` | `package` | A equipe conta embalagens físicas (ex.: "tenho 8 pacotes") — mais comum |
| `Unidade do Produto Base` | `base` | A equipe conta na unidade do Base (ex.: "tenho 40 kg") |
| `Unidade do Conteúdo` | `content` | A equipe mede o conteúdo diretamente (ex.: pesa os gramas restantes) |

**Recomendação geral:** use `Unidade do Lote` — é a mais intuitiva para o operador de estoque, que está olhando para embalagens físicas.

---

### Seção 6 — Instrução de Contagem (card azul-claro, ativado por switch)

> 📸 **[Screenshot: seção "Instrução de Contagem" com switch desligado]**
> 📸 **[Screenshot: seção "Instrução de Contagem" com switch ligado, mostrando campo de texto e área de foto]**

**Rótulo:** `Instrução de Contagem`
**Descrição na tela:** *"Adicione um texto ou imagem para guiar a contagem."*
**Ativação:** switch (desligado por padrão)

Habilite quando o produto exige uma instrução especial para ser contado corretamente. A instrução aparece para o operador durante o inventário físico (ícone ℹ️ ao lado do campo de quantidade no formulário de Lote).

#### Campo: Texto da instrução (quando ativo)

**Rótulo:** `Texto da instrução`
**Placeholder:** `Ex: Contar por peso na balança...`

Escreva de forma simples e direta. Ex.: *"Abra a caixa logística, empilhe os sachês e conte. Cada caixa deve ter 24 sachês."*

#### Imagem de instrução (quando ativo)

Uma foto mostrando visualmente como contar. Mesmos botões da foto principal: **Câmera** (tirar foto) ou **Upload** (arquivo).

**Quando usar instrução:**
- Produto que vem em caixa logística e precisa ser desembalado para contar
- Produto que é pesado ao invés de contado (ex.: queijo a granel)
- Produto com múltiplas formas de apresentação (aberto/fechado, fracionado/inteiro)

---

### Seção 7 — Vínculo e observações (card violeta)

> 📸 **[Screenshot: seção "Vínculo e observações" com os campos Categoria do item, Insumo base e Observações]**

#### Campo: Categoria do item ⚠️ Obrigatório

**Rótulo na tela:** `Categoria do item`
**Placeholder:** `Selecione a categoria do item...`
**Obrigatório:** sim
**Descrição na tela:** *"Esta categoria define como o item será tratado nas compras e no recebimento."*

Este campo classifica o Derivado **operacionalmente** — ou seja, para qual finalidade e fluxo ele pertence dentro do sistema. É completamente independente da `Categoria da unidade` (Seção 3), que trata apenas de conversões de medida.

| Aspecto | Categoria da unidade (Seção 3) | Categoria do item (Seção 7) |
|---|---|---|
| O que define | Família de grandeza física (Volume, Massa…) | Tipo operacional do item (insumo, limpeza…) |
| Lista | Fechada — definida pelo sistema | Aberta — a empresa cria e gerencia |
| Afeta conversões? | **Sim** | Não |
| Deve igualar o Base? | **Sim** — obrigatório | Não — exclusivo do Derivado |
| Efeito prático | Garante que `g` converte para `kg` corretamente | Define fluxo de compra, recebimento e relatórios |

**Categorias padrão do sistema:**

| Nome | Destinação | Quando usar |
|---|---|---|
| `Insumo` | Estoque | Ingredientes alimentares, matérias-primas de produção |
| `Material de Limpeza` | Estoque | Produtos de higiene e saneamento |
| `Vestimenta` | Uniforme | Roupas, uniformes e EPIs têxteis |

> Categorias com destinação `Patrimônio` são filtradas automaticamente e **nunca aparecem** neste dropdown — elas pertencem ao cadastro de Assets. Consulte a seção [Sobre o módulo de Patrimônio](#sobre-o-módulo-de-patrimônio) ao final deste guia.

**A empresa pode criar categorias personalizadas** além das padrão — por exemplo:

- `Perecíveis` — para separar insumos com validade curta dos demais
- `Não Perecíveis` — secos, enlatados, embalados de longa duração
- `Descartáveis` — copos, sacolas, embalagens de entrega
- `Higiene Pessoal` — itens de uso individual da equipe

Categorias personalizadas são criadas em **Configurações → Operacional → Cadastros → aba "Insumo derivado" → botão "Categorias de item"**. Ao criar, é necessário definir a **Destinação** (`Estoque`, `Uniforme` ou `Patrimônio`) — isso determina em qual módulo os itens dessa categoria aparecem.

> **Exemplo prático:** `Álcool Gel 70% 500ml Frasco` tem:
> - `Categoria da unidade = Volume` (medido em ml/l — define a conversão)
> - `Categoria do item = Material de Limpeza` (define que vai para o fluxo de compras de limpeza)

#### Campo: Insumo base

**Rótulo na tela:** `Insumo base`
**Placeholder:** `Selecione para agrupar este insumo...`
**Obrigatório:** não (mas fortemente recomendado)

Selecione o Insumo Base ao qual este Derivado pertence. É aqui que você faz o vínculo da hierarquia.

**O botão ⚙️ ao lado:** abre o gerenciador de Insumos Base sem fechar o formulário atual. Use quando o Base ainda não existe e precisa ser criado.

**Alerta vermelho automático:** se a Categoria deste Derivado for diferente da Categoria do Base selecionado, o sistema exibe um aviso: *"A categoria deste insumo é diferente da categoria do produto base. A conversão de unidades pode não funcionar corretamente."* O salvamento é bloqueado.

> 📸 **[Screenshot: alerta vermelho de incompatibilidade de categoria]**

#### Campo: Observações

**Rótulo na tela:** `Observações`
**Placeholder:** `Insira observações (opcional)`

Campo livre para qualquer informação adicional. Exemplos:
- *"Manter refrigerado após abertura"*
- *"Verificar prazo impresso na lateral da caixa antes de dar entrada"*
- *"Fornecedor A entrega em fardos, Fornecedor B em pacotes avulsos"*

---

### Seção 8 — Tabela Nutricional e Composição (card verde-esmeralda)

> 📸 **[Screenshot: seção "Tabela Nutricional e Composição" com os dois slots de foto lado a lado]**

**Rótulo:** `Tabela Nutricional e Composição`
**Descrição na tela:** *"Fotografe a embalagem. Os dados serão transcritos pelo assistente quando solicitado."*

Esta seção é opcional e serve para registrar informações nutricionais do produto.

**Foto — Tabela Nutricional:** fotografe a tabela nutricional impressa na embalagem (calorias, gorduras, proteínas, etc.). Botões: **Câmera** ou **Upload**.

**Foto — Composição / Ingredientes:** fotografe a lista de ingredientes da embalagem. Botões: **Câmera** ou **Upload**.

Após as fotos serem adicionadas, você pode solicitar ao assistente de IA que transcreva os dados — ele extrai os nutrientes, a composição e os alérgenos detectados, exibindo uma tabela nutricional formatada dentro do próprio formulário (somente leitura).

**Onde esses dados aparecem:** depois de salvos, as informações nutricionais ficam disponíveis na **Ficha do Produto** — acessível na lista de Insumos, clicando no nome do Derivado. A ficha exibe a tabela de nutrientes por porção, a lista de ingredientes (composição) e os alérgenos identificados.

---

### Salvando o Insumo Derivado

> 📸 **[Screenshot: botão "Adicionar insumo" no rodapé do modal]**

Clique em **"Adicionar insumo"** (novo) ou **"Salvar alterações"** (edição). O sistema valida:
- Nome preenchido
- Tipo de embalagem selecionado
- Qtd. embalagem > 0,001
- Unidade preenchida
- Se logística ativa: Quantidade > 0 e Tipo de agrupamento selecionado
- Categorias compatíveis entre Derivado e Base vinculado

**Alertas de validade:** o sistema alerta automaticamente quando um lote se aproxima do vencimento, usando dois limiares fixos: **30 dias** (alerta amarelo) e **7 dias** (alerta vermelho/urgente). Esses valores são padrões do sistema e não são configuráveis no formulário de cadastro.

**Arquivar um Insumo Derivado:** nunca delete um Derivado que já teve movimentações. Para desativar sem perder histórico, abra a lista de Insumos, clique no menu ⋮ (kebab) ao lado do item e selecione **"Arquivar"**. Derivados arquivados ficam ocultos nas buscas e na seleção de novos lotes, mas o histórico permanece intacto.

---

## 6. Nível 3 — Lote: como cadastrar

O Lote é a entrada física real no estoque. Cada vez que um produto chega — seja via compra manual, seja por ajuste de inventário — um Lote é criado. É aqui que o estoque efetivamente aumenta.

**Por que registrar por Lote?** Para rastreabilidade total: saber exatamente qual produto, de qual fornecimento, com qual validade, está em qual local. Isso é essencial para o controle FEFO (First Expired, First Out — primeiro que vence, primeiro que sai), para devoluções e auditorias sanitárias.

**Como acessar:** Menu lateral → Operacional → Gestão de Estoque → botão "Adicionar lote"

> 📸 **[Screenshot: modal "Adicionar novo lote ao estoque" — visão geral com as duas seções]**

O formulário tem duas etapas visuais: primeiro você identifica o produto, depois preenche os detalhes do lote. A segunda etapa só aparece após o produto ser selecionado.

---

### Etapa 1 — Selecione o insumo (seção com fundo cinza)

> 📸 **[Screenshot: seção "1. Selecione o insumo" com os dois selects e o botão de câmera]**

**Título na tela:** `1. Selecione o insumo`
**Descrição na tela:** `Selecione primeiro o insumo base e depois a variação.`

Esta etapa funciona em dois selects encadeados. O segundo só é habilitado após o primeiro ser preenchido.

#### Atalho: botão de câmera 📷

No canto superior direito da seção há um botão de câmera. Clique nele para abrir o leitor de código de barras — se o produto tiver o código cadastrado no Derivado, o sistema seleciona automaticamente o Insumo Base e o Derivado correspondentes.

#### Select 1: Insumo Base

**Placeholder:** `Selecione o insumo base...`

Lista todos os Insumos Base ativos (não arquivados). Selecione o ingrediente genérico do produto que está entrando.

**Por que selecionar o Base primeiro:** em operações com centenas de produtos, a lista de Derivados seria impraticável sem esse filtro. Ao selecionar `Leite em Pó`, o segundo select mostra apenas os Derivados de leite em pó.

#### Select 2: Variação (Insumo Derivado)

**Placeholder:** `Selecione a variação...`
**Desabilitado:** até que o Insumo Base seja selecionado

> **Nota de terminologia:** nesta tela, o Insumo Derivado é chamado de **"variação"**. É a mesma coisa — apenas a palavra usada na interface de cadastro de Lote.

Mostra apenas os Insumos Derivados vinculados ao Base escolhido e que não estão arquivados. Selecione a embalagem exata que está dando entrada: marca, tamanho, tipo de embalagem corretos.

> **Atenção:** selecione o Derivado certo. Um `Leite em Pó Ninho 400g Sachê` e um `Leite em Pó Ninho 1kg Lata` são Derivados diferentes com conversões diferentes. Escolher o errado gera quantidade incorreta no estoque.

---

### Etapa 2 — Detalhes do lote (seção com borda)

> 📸 **[Screenshot: seção "2. Detalhes do lote" completa com todos os campos preenchidos de exemplo]**

**Título na tela:** `2. Detalhes do lote`

Esta seção só aparece após um Insumo Derivado ser selecionado.

#### Campo 1: Número do lote

> 📸 **[Screenshot: campo "Número do lote" com placeholder "ex: L12345"]**

**Rótulo na tela:** `Número do lote`
**Placeholder:** `ex: L12345`
**Obrigatório:** sim

O código identificador do lote de fabricação. Geralmente impresso na embalagem pelo fabricante.

**Onde encontrar na embalagem:** procure por `LOT`, `LOTE`, `BATCH`, `L:` ou a combinação `Fab:` + `Val:`.

**Quando não há código do fabricante**, crie um código interno padronizado:
- Por data: `L2026-05-001` (Lote de maio de 2026, primeiro do mês)
- Por fornecedor + data: `NESTLE-2026-05-A`

**Regra de merge automático:** se você registrar um Lote com a mesma combinação de `Derivado + Kiosk + Número do Lote + Data de Validade`, o sistema **soma a quantidade** ao lote existente em vez de criar um registro novo. Isso é o comportamento correto quando chega uma segunda entrega do mesmo lote físico.

> ⚠️ **Cuidado:** se dois lotes físicos têm validades diferentes mas você usou o mesmo número por descuido, o sistema cria dois registros com o mesmo número — situação confusa no inventário. Sempre use números diferentes para lotes diferentes.

#### Campo 2: Data de validade

> 📸 **[Screenshot: campo "Data de validade" com o calendário aberto e o botão X para limpar]**

**Rótulo na tela:** `Data de validade`
**Padrão quando vazio:** exibe `Indefinida`
**Tipo:** seletor de calendário

Clique no campo para abrir o calendário. Datas passadas ficam desabilitadas — só é possível selecionar datas futuras. O botão **×** ao lado do campo limpa a data selecionada (voltando para "Indefinida").

**Quando definir como Indefinida (sem data):**
- Sal refinado, açúcar cristal em embalagem fechada
- Materiais de limpeza sem validade impressa
- Uniformes, EPIs e itens têxteis
- Embalagens descartáveis (copos, sacolas, etc.)

**Por que a data importa:**
1. O sistema usa essa data para calcular os alertas de vencimento (alerta amarelo e vermelho) configurados no Insumo Derivado.
2. O controle FEFO — priorizar o consumo do lote que vence primeiro — depende inteiramente dessa data. Sem ela, o sistema não consegue ordenar os lotes por validade.

#### Campo 3: Quantidade e Quiosque (lado a lado)

> 📸 **[Screenshot: campos "Quantidade" e "Quiosque" lado a lado]**

**Campo Quantidade:**
**Rótulo na tela:** `Quantidade`
**Obrigatório:** sim — mínimo `0,01`

A quantidade que está entrando no estoque. **Sempre na unidade do Insumo Derivado selecionado** — não na unidade do Insumo Base, não na caixa logística.

| Derivado selecionado | "Quantidade = 12" significa |
|---|---|
| Leite em Pó Ninho 400g Sachê | 12 sachês → 4,800 kg |
| Óleo de Soja 900ml Garrafa | 12 garrafas → 10,800 l |
| Farinha de Trigo 5kg Pacote | 12 pacotes → 60 kg |
| Copo Descartável Pct c/100 | 12 pacotes → 1.200 copos |

> Se o Derivado tem logística configurada (ex.: `Caixa c/12 frascos`), a quantidade do Lote ainda é em frascos — não em caixas. A unidade logística é usada apenas no módulo de compras, não no Lote manual.

Se houver uma instrução de contagem cadastrada no Derivado, um ícone ℹ️ aparece ao lado do campo — clique para ver a instrução.

**Campo Quiosque:**
**Rótulo na tela:** `Quiosque`
**Placeholder:** `Selecione`
**Obrigatório:** sim

O local operacional onde este estoque ficará disponível e controlado.

**Regra:** um Lote pertence a **um único kiosk**. Se o mesmo produto foi recebido em dois locais diferentes, crie dois Lotes separados — um para cada kiosk. Misturar kiosks invalida o controle de estoque por localidade.

#### Campo 4: Localização (opcional)

> 📸 **[Screenshot: campo "Localização" com o select e o botão de engrenagem ao lado]**

**Rótulo na tela:** `Localização (opcional)`
**Desabilitado:** até que o Quiosque seja selecionado

Uma posição física específica dentro do kiosk: prateleira, câmara fria, freezer, armário. A lista exibe apenas os locais cadastrados dentro do kiosk selecionado.

**O botão ⚙️ ao lado:** abre o gerenciador de locais de armazenamento sem fechar o formulário.

**Quando preencher:** sempre que sua operação tiver posições físicas catalogadas. Facilita muito o inventário — o operador sabe exatamente onde buscar o produto.

**Quando deixar vazio:** se o kiosk é um espaço único sem subdivisões catalogadas.

---

### Salvando o Lote

> 📸 **[Screenshot: botão "Adicionar lote" no rodapé do modal]**

Clique em **"Adicionar lote"**. O sistema valida:
- Insumo Derivado selecionado
- Número do lote preenchido
- Quantidade > 0,01
- Kiosk selecionado

Após salvar, o sistema cria automaticamente um registro de movimentação do tipo `ENTRADA` no histórico — rastreando quem adicionou, quando e quanto.

---

## 7. A fórmula de conversão explicada

Entender como o sistema converte unidades evita muitos erros de cadastro.

### Conversão dentro da categoria

A fórmula base é:

```
Valor na Unidade Destino = Valor × (Fator da Unidade Origem / Fator da Unidade Destino)
```

Onde os fatores são:

| Unidade | Fator (em relação à unidade base da categoria) |
|---|---|
| `kg` | 1 |
| `g` | 0,001 |
| `mg` | 0,000001 |
| `l` | 1 |
| `ml` | 0,001 |
| `un`, `pacote`, `caixa`, `bag` | 1 (adimensional) |
| `peça` | 1 (adimensional) |

**Exemplo 1:** Derivado com 400g, Base em kg:
```
400 (g) × (0,001 / 1) = 0,400 kg
```

**Exemplo 2:** Derivado com 900ml, Base em l:
```
900 (ml) × (0,001 / 1) = 0,900 l
```

**Exemplo 3:** Derivado com 5kg, Base em kg (mesmo sistema):
```
5 (kg) × (1 / 1) = 5 kg
```

### Conversão com Unidade Logística

Quando `purchaseUnitType = logistic` (comprando por caixa):

```
Base por Caixa = packageSize_em_base × multiplo_caixa
```

**Exemplo:** Álcool Gel 500ml Frasco, caixa com 12 frascos:
```
Frasco → Base: 500ml × 0,001 = 0,500 l
Caixa  → Base: 0,500 l × 12  = 6,000 l
```

### Por que as categorias Unidade, Embalagem e Vestimenta não têm conversão de escala

Nessas categorias, todas as unidades (`un`, `pacote`, `caixa`, `bag`, `peça`) têm fator 1. Isso significa que a "conversão" é sempre 1:1 — o que na prática não converte nada.

Nessas categorias, quem faz o trabalho de conversão é o `packageSize` do Derivado:

```
Base: Luva Nitrílica (un)
Derivado: Caixa c/100 luvas → packageSize = 100, unit = un

1 Caixa → 100 × (1/1) = 100 un (unidades individuais)
```

---

## 8. O que NUNCA fazer ao cadastrar

### ❌ Criar um Insumo Base com categoria diferente da realidade física

**Errado:** `Leite Integral Fluido` com categoria `Massa`
**Correto:** `Leite Integral Fluido` com categoria `Volume`

O leite fluido é medido em litros, não em quilos. Se você cadastrar como Massa, os Derivados precisarão ter unidade de Massa (kg, g), o que vai gerar números sem sentido (ex.: "1kg de leite em caixinha de 1l").

---

### ❌ Criar Insumos Base separados para marcas diferentes do mesmo ingrediente

**Errado:** criar `Óleo de Soja Liza` e `Óleo de Soja Soya` como dois Insumos Base.
**Correto:** criar um único Insumo Base `Óleo de Soja` e dois Derivados (um para cada marca).

O Insumo Base representa o ingrediente, não o fornecedor. Marcas diferentes são Derivados do mesmo Base — assim o sistema consolida o estoque total de óleo de soja, independente de quem forneceu.

---

### ❌ Colocar o tamanho ou a marca no nome do Insumo Base

**Errado:** `Leite em Pó Ninho 400g`
**Correto:** `Leite em Pó` (Base) + `Leite em Pó Ninho 400g Sachê` (Derivado)

O nome do Base deve ser atemporal e independente de embalagem.

---

### ❌ Usar `ml` no Insumo Base quando o volume é grande

**Errado:** `Óleo de Soja` com unidade `ml` → estoque aparece como "18.000 ml"
**Correto:** `Óleo de Soja` com unidade `l` → estoque aparece como "18 l"

Use a unidade que torna os números mais legíveis no nível do Base.

---

### ❌ Criar um Derivado com categoria diferente do Insumo Base vinculado

**Errado:** Base `Leite em Pó` (Massa/kg) + Derivado `Leite em Pó Sachê` (Volume/ml)
**Correto:** Base `Leite em Pó` (Massa/kg) + Derivado `Leite em Pó Sachê` (Massa/g) com packageSize 30

Leite em pó é sólido — sua embalagem tem gramas, não mililitros.

---

### ❌ Informar a quantidade de caixas no Lote quando o Derivado é frasco/sachê

**Errado:** Derivado é `Frasco 500ml`, chegaram 2 caixas com 12 frascos cada → informar `2` no Lote
**Correto:** informar `24` (frascos)

No formulário de Lote manual, a quantidade é sempre na unidade do Derivado — sem exceção. A unidade logística (Caixa, Fardo) existe somente no módulo de compras; ela não está disponível no cadastro de Lote. Se você quer lançar compras em caixas, faça isso pelo módulo de Recebimento de Compra, que respeita a logística configurada no Derivado.

---

### ❌ Usar o mesmo número de lote para produtos com validades diferentes

**Errado:** usar `L001` para dois recebimentos diferentes do mesmo produto com validades distintas.
**Correto:** `L2026-04-001` (validade jan/2027) e `L2026-05-001` (validade mar/2027) — lotes separados.

O sistema diferencia lotes pela combinação: produto + kiosk + número do lote + validade. Se número e validade são iguais, ele faz merge (soma quantidades). Se a validade for diferente mas você usar o mesmo número por engano, vai criar dois registros com o mesmo número mas validades diferentes — confuso no inventário.

---

### ❌ Deletar um Derivado ou Base que já teve movimentações

**Errado:** excluir um Derivado descontinuado.
**Correto:** arquivar (marcar `isArchived: true`).

A exclusão remove o histórico de movimentações, quebra relatórios antigos e pode gerar erros em compras e inventários que referenciam aquele produto.

---

### ❌ Deixar o packageSize a 1 quando a embalagem tem múltiplas unidades

**Errado:** Derivado `Copo Descartável 200ml Cx/2500` com packageSize `1`
**Correto:** packageSize `2500`, unit `un`

Se você informar 1, o sistema entende que cada "Caixa" tem 1 copo. Quando der entrada de 3 caixas, o estoque vai mostrar 3 copos — não 7.500.

---

## 9. Exemplos de uma operação real — do início ao fim

### Operação: Cafeteria com preparo próprio

#### Passo 1: Cadastrar os Insumos Base

| Nome | Categoria | Unidade | Classificação |
|---|---|---|---|
| Café Torrado e Moído | Massa | kg | Bebidas |
| Leite Integral | Volume | l | Laticínios |
| Açúcar Refinado | Massa | kg | Adoçantes |
| Copo Descartável 200ml | Unidade | un | Descartáveis |
| Tampa Copo 200ml | Embalagem | un | Descartáveis |
| Avental de Cozinha | Vestimenta | peça | Uniformes |

---

#### Passo 2: Cadastrar os Insumos Derivados

**Café Torrado e Moído** → Insumo Base: `Café Torrado e Moído` (Massa/kg)

| Nome do Derivado | Marca | packageSize | unit | packageType | Logística | Categoria do item |
|---|---|---|---|---|---|---|
| Café Torrado e Moído 500g Pacote | Três Corações | 500 | g | Pacote | — | Insumo |
| Café Torrado e Moído 1kg Pacote | Três Corações | 1 | kg | Pacote | — | Insumo |
| Café Torrado e Moído 500g Pacote | Pilão | 500 | g | Pacote | CX/10 | Insumo |

O terceiro Derivado (Pilão com logística) permite comprar em caixas de 10 pacotes: 1 CX = 10 × 500g = 5.000g = 5 kg.

---

**Leite Integral** → Insumo Base: `Leite Integral` (Volume/l)

| Nome do Derivado | Marca | packageSize | unit | packageType |
|---|---|---|---|---|
| Leite Integral 1L Caixinha | Piracanjuba | 1 | l | Caixa |
| Leite Integral 1L Caixinha | Itambé | 1 | l | Caixa |
| Leite Integral 200ml Sachê | Piracanjuba | 200 | ml | Sachê |

Dois Derivados de 1L — um de cada marca. O sistema consolida ambos como "litros de leite integral".

---

**Copo Descartável 200ml** → Insumo Base: `Copo Descartável 200ml` (Unidade/un)

| Nome do Derivado | packageSize | unit | Logística |
|---|---|---|---|
| Copo Descartável 200ml — Pct c/100 | 100 | un | CX / multiplo=25 |

1 Pacote = 100 copos. 1 CX = 25 pacotes = 2.500 copos. A equipe de compras pode lançar em pacotes ou em caixas.

---

#### Passo 3: Registrar Lotes após recebimento de compra

**Recebimento do dia 22/05/2026:**

| Derivado | Nº Lote | Validade | Kiosk | Qtd | Sistema calcula |
|---|---|---|---|---|---|
| Café Três Corações 500g | L2026-05-TC | 2027-08-01 | Cozinha | 20 (pacotes) | 10 kg |
| Leite Piracanjuba 1L Caixinha | L2026-05-PI | 2026-07-15 | Cozinha | 48 (caixinhas) | 48 l |
| Leite Itambé 1L Caixinha | L2026-05-IT | 2026-08-01 | Cozinha | 24 (caixinhas) | 24 l |

Agora o sistema mostra:
- **Café Torrado e Moído:** 10 kg disponíveis
- **Leite Integral:** 72 l disponíveis (48 + 24, marcas consolidadas)

---

#### Passo 4: O que acontece no consumo?

Quando o sistema registra consumo de leite para preparar bebidas, ele desconta do lote seguindo FEFO — primeiro o lote com validade mais próxima (Piracanjuba, vence 15/07) e só depois o de validade mais distante (Itambé, vence 01/08).

---

### Operação: Entrada de uniforme

**Base:** `Camiseta Polo Uniforme` (Vestimenta/peça)

**Derivados:**
- `Camiseta Polo Branca M Feminino` → apparelSize: M, apparelColor: Branco, apparelFit: Feminino
- `Camiseta Polo Branca G Feminino` → apparelSize: G, apparelColor: Branco, apparelFit: Feminino
- `Camiseta Polo Preta M Masculino` → apparelSize: M, apparelColor: Preto, apparelFit: Masculino

**Lote para entrega de uniformes:**
- Derivado: `Camiseta Polo Branca M Feminino`
- Nº Lote: `UNIF-2026-05`
- Sem validade
- Kiosk: `Almoxarifado RH`
- Quantidade: `15` (peças)

---

## Sobre o módulo de Patrimônio

Este guia cobre exclusivamente os módulos de **Insumo Base**, **Insumo Derivado** e **Lote** — o que o sistema chama de fluxo de estoque de insumos.

Existe um módulo separado chamado **Patrimônio (Assets)**, destinado a equipamentos, utensílios e bens duráveis da operação (forno, refrigerador, fatiador, etc.). O cadastro de Patrimônio tem seu próprio formulário, suas próprias categorias e um fluxo de controle distinto do estoque de insumos.

> Por isso, a **Categoria do item** `Patrimônio` não aparece no formulário de Insumo Derivado — ela é exclusiva do cadastro de Assets.

O guia detalhado do módulo de Patrimônio está em elaboração. Enquanto isso, qualquer dúvida sobre cadastro de equipamentos ou bens patrimoniais deve ser direcionada ao time de TI ou ao administrador do sistema.
