# Retomada — conciliação e Coala Financeiro

Recuperado em 22/09/2026 após o desligamento do computador. Este documento registra
as decisões da conversa anterior e o ponto real da implementação; não declara o
módulo completo nem substitui os contratos técnicos já documentados.

## Origem e última confirmação

O histórico local da sessão iniciada em 21/09/2026 às 15:03 foi preservado. As
decisões abaixo estão nas mensagens de 22/09, entre 16:56 e 17:19 (America/Belem).

Às 17:18, foi registrado: “O próximo trabalho é concluir Vendas e recebíveis,
começando pela agenda futura e depois pela comparação PDV × Stone.” O usuário
respondeu “ok” às 17:19. Essa é a sequência de implementação retomada, e não apenas
a publicação da última branch.

O plano anterior está em [plano-integracao-stone-conciliacao.md](plano-integracao-stone-conciliacao.md).
A conversa de 22/09 atualizou suas prioridades: seguir sem a Banking API Stone por
enquanto, reutilizar os módulos existentes e desenvolver o agente por capacidades.
As etapas antigas de habilitação bancária não bloqueiam a leitura de conciliação
já disponível. Datas de publicação citadas abaixo são registros da sessão anterior,
não uma nova verificação do ambiente de produção.

## Decisões preservadas

- Deixar a integração de saldo/extrato da Banking API Stone fora por enquanto.
- Pagamento informado pela Stone não é crédito confirmado no banco nem caixa realizado.
- Preservar a conciliação de extrato existente em Despesas e seus vínculos.
- Reutilizar a mesma fatura em Contas a pagar e em Conciliação, sem duplicar compras.
- Não duplicar cadastros, livros financeiros, fechamento de caixa ou depósitos.
- Coala Financeiro analisa e apresenta evidências; decisões que alterem registros
  financeiros dependem da confirmação do usuário.
- Recebíveis e Coala Financeiro ficam dentro de Fluxo de caixa, abaixo de Conciliação.
- O agente financeiro não assume campanhas ou estratégia do agente comercial.

## Organização combinada

```text
Financeiro
├── Painel Financeiro
├── Contas a pagar
│   ├── Despesas
│   └── Faturas de cartão
├── Controle de caixa
│   ├── Fechamento do caixa
│   └── Depósitos
├── Conciliação
│   ├── Extrato bancário
│   ├── Faturas de cartão
│   └── Vendas e recebíveis
│       └── Antecipações Stone
├── Fluxo de caixa
│   ├── Visão do caixa
│   ├── Recebíveis
│   └── Coala Financeiro
├── DRE
└── Patrimônio
```

Essa é a organização alvo. Um acesso na navegação não comprova que toda a função
correspondente esteja implementada ou publicada.

## Sequência recuperada e estado

| Etapa | Resultado esperado | Estado na retomada |
|---|---|---|
| Antecipações | Consulta por unidade, parcelas, taxas e evidências | Publicação e consulta real registradas na sessão anterior. |
| Navegação | Grupos Conciliação e Fluxo de caixa preservando operações atuais | Commit local `2fdd399c`, branch `feat/financial-reconciliation-navigation`; não publicada conforme último registro. |
| 1. Agenda futura | Recebíveis líquidos, vencimentos e exclusão das parcelas já antecipadas | Entrega parcial no commit `99c18a84`, branch `feat/stone-future-receivables`: conferência por período, sem posição completa da carteira. |
| 2. Conciliação de vendas | PDV × Stone por unidade, data e meio de pagamento; Pix, cancelamentos e estornos | Há base em branch separada; falta concluir e validar sua integração com a fonte real. |
| 3. Taxas e DRE | Consultar a DRE oficial e preparar classificação nas contas existentes | Integração ao fluxo/agente pendente; aprovação humana para efeitos financeiros. |
| 4. Fluxo de caixa | Combinar contas a pagar, recebíveis e saldos confirmados; separar realizado e previsto | Integração pendente; não presumir saldo Stone sem fonte bancária. |
| 5. Análise gerencial | Orçamento, histórico, indicadores, materialidade e investigação de desvios | Ampliação do agente pendente. |
| 6. Rotina do agente | Mais perguntas, análises periódicas e alertas com acompanhamento | Ampliação pendente; a leitura guiada atual não equivale ao agente completo. |

## O que já existe e deve ser reaproveitado

A branch `feat/stone-reconciliation-integration`, no worktree
`Coala-OP-stone-reconciliation-integration`, possui uma implementação anterior de
matching, decisões, ingestão canônica, recebíveis, liquidações, projeção de caixa e
DRE. Seu handoff é `docs/stone-reconciliation-session-handoff-2026-09-19.md`, commit
`5716fc21`, sobre `e302b2b3`.

Não confundir essa base com o fluxo conectado e validado: o handoff ainda descrevia
a ausência do adaptador real. Desde então, outras branches entregaram a leitura
XML de conciliação e antecipações. É necessário comparar e integrar esses contratos,
inclusive os escritores de `stoneMerchantMappings`, antes de reutilizar tudo junto.

Na inspeção desta retomada, havia uma alteração não commitada em `apphosting.yaml`
na branch antiga. Ela foi preservada; não transportar ou sobrescrever sem revisar.

## Limite da entrega de recebíveis atual

O commit `99c18a84` compara capturas e pagamentos encontrados em até 31 arquivos
diários, com pendências explícitas. Não cobre vendas anteriores ao intervalo, posição
da registradora ou histórico integral da carteira. Logo, a etapa 1 ainda não pode
ser marcada como agenda completa ou saldo disponível.

Validação executada: 1.333 testes unitários, quatro testes de API em emuladores e
`verify` com build aprovados; foi necessário `NODE_OPTIONS=--max-old-space-size=4096`.
Detalhes em [stone-receivable-period.md](engineering/stone-receivable-period.md).

## Próxima execução — desdobramento técnico da sequência combinada

1. Comparar a base anterior de recebíveis/conciliação com a leitura Stone atual e
   identificar o que é reutilizável, o que depende de fonte ainda indisponível e
   quais contratos precisam de adaptação. Não reimplementar a base sem essa revisão.
2. Fechar a etapa de agenda: cobertura da fonte, parcelas já pagas/antecipadas,
   vencimentos, pendências e apresentação contextual pelo Coala Financeiro. Integrar
   o acesso em Fluxo de caixa com a navegação já preparada. Se a fonte não sustentar
   a carteira completa, registrar essa parte como pendente, sem rebatizar o recorte.
3. Prosseguir para PDV × Stone reutilizando a base existente, com evidências por
   venda/pagamento, Pix, cancelamentos e estornos e testes do fluxo integrado.
4. Continuar taxas/DRE, fluxo de caixa e capacidades gerenciais na sequência acima.

Push, PR, CI, merge e publicação são passos de entrega de cada incremento; não são
o restante do plano de produto. Este registro não executa publicação, migração,
backfill, movimentação bancária ou lançamento financeiro.

## Manutenção do plano

### Incremento concluído localmente — agenda e agente

Branch `feat/receivables-agent-integration`, iniciada em `1efffb0b`, com a navegação
`2fdd399c` integrada como `002b950d`. Comparação das bases concluída: o importador
anterior exige centavos e pode gerar despesas de taxas; a consulta atual preserva
decimais e não escreve. A integração direta não satisfaz o contrato desta consulta.

Implementados acesso a Recebíveis em Fluxo de caixa, seleção de análises no Coala
Financeiro e quatro perguntas com evidências sobre a mesma consulta. A cobertura
integral da carteira permanece pendente e não foi marcada como entregue.
Detalhes e validação em [receivables-agent-integration.md](engineering/receivables-agent-integration.md).
Verificação concluída: 1.345 testes unitários, quatro testes de API em emuladores e
build aprovados. Acesso administrativo mantido, sem novas permissões ou migrações.

Próxima frente após este incremento: PDV × Stone, reaproveitando o motor existente,
validando a adaptação da fonte real antes de habilitar escrita e fechamento. A
completude da agenda persistida continua como dependência explícita, não resolvida
pela mera inclusão de links ou perguntas. Nenhuma publicação realizada neste incremento.

Atualizar este documento ao terminar cada incremento com commit, testes, limite de
cobertura, estado de publicação e próxima etapa. Distinguir sempre: código existente,
integração validada, publicação e comprovação com a fonte real.
