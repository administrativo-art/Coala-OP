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
│       ├── PDV × Stone
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
| 2. Conciliação de vendas | PDV × Stone por unidade, data e meio de pagamento; Pix, cancelamentos e estornos | Consulta diária e tela implementadas localmente em `feat/pdv-stone-flow`; Pix, histórico integral e comprovação com dados reais pendentes. |
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

### Incremento de domínio — PDV × Stone

Branch `feat/pdv-stone-review`, base `7e20c0aa`. Reaproveitado o motor da branch
antiga, com validação estrita e remoção da aprovação automática por coincidência.
Adaptadores puros conectam envelopes de cupons PDV e XML Stone às sugestões,
preservando pendências de valor, data, identidade, cancelamentos e eventos de conta.
Pix permanece explicitamente não comparado, aguardando fonte própria e vínculo de terminal.

Este incremento **não conclui a etapa 2**: não há nova tela, rota ou coleta ao vivo.
Próximo passo: coleta autenticada com limites/timeout e vínculo oficial da filial,
API administrativa, apresentação das evidências e E2E em emuladores. Não habilitar
lançamento ou fechamento automático. Nenhuma alteração de produção ou publicação.

Detalhes, limites e resultados dos testes em
[pdv-stone-daily-review.md](engineering/pdv-stone-daily-review.md).
Validação: 1.366 testes aprovados (21 novos), check aprovado e build com 171 páginas
aprovado sem cache persistente. A tentativa inicial de build falhou por disco cheio;
a configuração temporária usada na repetição não integra a entrega.

### Incremento de fluxo — PDV × Stone

Branch `feat/pdv-stone-flow`, base `268c9b23`. API administrativa somente leitura,
coleta limitada de um dia e tela de evidências em Conciliação → Vendas e recebíveis
→ PDV × Stone. Reutiliza o motor; exige filial PDV cadastrada e vínculo Stone
vigente, revalidados após a coleta. Não cria lançamentos ou decisões financeiras.

Pix e histórico integral de cancelamentos permanecem pendentes; a consulta de um
StoneCode não equivale à cobertura completa da unidade. Integração validada com
fontes HTTP sintéticas e E2E de autorização em emuladores, não com produção.
Validação concluída: `verify` aprovado, 1.378 testes unitários, build com 172 páginas
e E2E da API aprovado em duas execuções. Detalhes em
[pdv-stone-flow.md](engineering/pdv-stone-flow.md).
Nenhuma publicação realizada.

Próxima frente: completar fonte Pix e sua atribuição inequívoca à unidade, validar
a consulta com amostra real autorizada e depois seguir taxas/DRE conforme sequência
recuperada. Não considerar a etapa 2 integralmente entregue pela presença da tela.

### Incremento de identidade — Pix Stone

Branch `feat/stone-pix-identity`, base `6cad6847`. Registrada a informação do usuário:
somente a chave da conta Tirirical está disponível. A documentação vincula a chave
ao CPF/CNPJ, não comprova exclusividade de unidade operacional. Não são necessárias
novas chaves para desenvolver o parser; nenhuma credencial foi acessada.

O exemplo oficial contém StoneCode e terminal no campo adicional de algumas linhas.
O parser agora preserva essa evidência com validação estrita, sem inferir identidade
para linhas sem o campo ou com conflito. Isso permite preparar o futuro vínculo pelo
StoneCode já cadastrado, sem exigir sempre uma associação separada de serial.
Detalhes e fontes em [stone-pix-identity.md](engineering/stone-pix-identity.md).

Pix continua não comparado na tela. Próximo incremento: validar valores/eventos Pix
estritamente, ler um arquivo consistente com limite e resolver o vínculo oficial
antes de conectar a fonte à revisão PDV. Não atribuir todo o arquivo ao Tirirical
apenas pela origem da chave. Nenhuma publicação ou reprocessamento histórico.

Validação: `npm run check` aprovado (1.383 testes unitários, incluindo dez do parser
Pix), além da leitura do exemplo público da Stone. Sem novo build: incremento
isolado de normalização, sem mudanças de importação de produção, fronteiras ou rotas.

### Incremento de eventos — Pix Stone

Branch `feat/stone-pix-events`, base `5e198f71`. O parser passa a conservar evidência
versionada de centavos exatos, evento, E2E, refund e datas UTC com microssegundos.
Cancelamentos, valores inválidos, identidades ausentes e eventos relacionados ou
duplicados ficam fora dos candidatos. Os campos/resumo legados não são usados como
prova de venda única. Detalhes em [stone-pix-events.md](engineering/stone-pix-events.md).

Ainda não conclui a etapa 2: Pix não foi conectado à tela, nenhuma conta real foi
consultada e não houve publicação. Próximo passo: leitura limitada/consistente,
validação de escopo e vínculo oficial, conexão ao motor e testes integrados.

Validação concluída: `npm run check` aprovado, 1.395 testes unitários (12 novos),
checagem final de tipos repetida após o ajuste de UTC e exemplo público verificado.
Sem novo build: regra isolada no parser, sem alterações de importações de produção,
fronteiras server/client ou rotas. Permissões existentes não foram alteradas.

### Execução conjunta das frentes restantes

Autorização do usuário: implementar todas as frentes restantes. Branch
`feat/financial-plan-completion`, base `c5b7f83f`. O escopo não autoriza publicar,
executar pagamentos ou gerar lançamentos financeiros automaticamente.

Implementação validada localmente: Pix no fluxo PDV × Stone; análise integrada de taxas,
DRE, caixa e desvios; configuração/execução de rotinas e acompanhamento de alertas.
Reutiliza fontes, contas, despesas e regras existentes. As limitações de carteira,
histórico, fonte bancária e dados reais permanecem explícitas, não marcadas como
resolvidas por uma nova tela. Scheduler implementado, desativado por padrão.

Detalhes, permissões, preflight de custos, índices, testes e critérios de publicação
em [financial-plan-completion.md](engineering/financial-plan-completion.md).

### Retomada após desligamento — 23/09/2026

O usuário escolheu continuar esta frente financeira. Alterações recuperadas na
mesma branch `feat/financial-plan-completion`, preservando o trabalho separado
de compras/provisões.

| Frente | Implementação local | Dependência ainda aberta |
|---|---|---|
| PDV × Stone / Pix | Fonte Pix versionada ligada à consulta diária, com validação de arquivo, escopo e evidências. | Publicação, homologação real e eventual reprocessamento autorizado de arquivos antigos. Histórico integral de cancelamentos/estornos não comprovado. |
| Taxas e DRE | DRE oficial integrada e evidências para classificação nas contas existentes. | Conferência humana antes de lançar; diferença de antecipação não comprova taxa. |
| Caixa | Extrato confirmado separado de despesas e recebíveis previstos; pagamento parcial conserva apenas o saldo da obrigação. | Fonte de saldo bancário e carteira completa ainda ausentes; posição final não comprovada. |
| Gerencial | Duas competências, orçamento informado, materialidade, maiores despesas e alertas. | Orçamento é cenário informado, sem cadastro aprovado; cobertura parcial explícita. |
| Rotinas | Configuração, execução administrativa, idempotência, histórico e ciência dos alertas. | Publicação dos índices, configuração autorizada do agendador e medição de custo antes de frequência diária. |

Na revisão, removida a leitura de coleção de saldos sem produtor canônico nesta base.
O formulário de rotinas passou a recuperar os parâmetros salvos. O teste integrado
de pagamento parcial foi preservado para validar R$ 5 realizados + R$ 5 previstos
em uma obrigação de R$ 10, sem inferir saldo da conta.

Validação concluída: `NODE_OPTIONS=--max-old-space-size=4096 npm run verify`
aprovado, com 1.405 testes unitários, tipos, lint, contrato de erros, skills e build
de produção. Dois testes de API em emuladores aprovados (`management.spec.ts` e
`pdv-stone-review.spec.ts`), sem navegador nem credenciais bancárias reais. Build
emitiu avisos de dependências Firebase/protobuf nos módulos existentes. Arquivos
temporários de configuração de testes removidos após a execução.

Próximo passo de entrega: publicação autorizada do código e dos índices, seguida
de homologação por unidade com as fontes disponíveis. Scheduler permanece
desativado; nenhuma publicação, pagamento ou lançamento financeiro realizado nesta
retomada. Permissões administrativas reutilizadas, sem migração de perfis.

### Investigação da carteira — layout 2.4

O usuário pediu continuar a validação do 2.4 antes de solicitar ajuda à Stone.
Branch `feat/stone-wallet-position`, base `a8367419`. O endpoint público documenta
XML2_4, WalletPosition e naturezas de garantia/cessão/antecipação. A integração
anterior pede XML2_2; por isso não havia evidência suficiente para concluir que
outro endpoint ou habilitação seria necessariamente exigido.

Preparada consulta administrativa separada de posição diária, com o transporte
existente e parser estrito, mantendo os consumidores 2.2 intactos. Exemplo público
oficial validado; consulta real do Tirirical depende de publicar a nova rota com
o segredo já mantido no servidor. WalletPosition não foi tratado como carteira
integral por vencimento nem saldo bancário. Sem backfill, deploy ou lançamentos.
Contrato, custo e critérios de cobertura em
[stone-wallet-position.md](engineering/stone-wallet-position.md).

Validação local concluída: `npm run verify` aprovado com 1.416 testes unitários e
build; cinco testes de autorização/entrada da API aprovados em emuladores demo.
Consulta real e publicação seguem pendentes; não declarar carteira integral ou
saldo bancário resolvidos. Permissões administrativas reutilizadas, sem migração.
