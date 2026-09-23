# Integração das frentes do plano financeiro

Branch `feat/financial-plan-completion`, base `c5b7f83f`. Implementação local a pedido
do usuário para avançar todas as frentes. Não equivale a publicação, homologação
com contas reais ou comprovação de carteira integral.

## Contratos e reutilização

- Pix: parser versionado anterior, arquivo diário do webhook, vínculo oficial
  StoneCode/unidade e motor PDV × Stone. Leitor transacional somente leitura,
  metadados e linhas no mesmo snapshot, hash e contagem obrigatórios, máximo 500
  linhas (501 como sentinela). Arquivo legado, parcial ou em processamento permanece
  pendente. Não se infere unidade pela chave. Microssegundos preservados; matching
  temporal continua heurístico, nunca aprovação.
- Taxas/DRE: reaproveitados fonte oficial `getDreSourceData` e cálculo oficial de
  despesas/rateios `calculateDreExpenses`, com duas competências, CMV por composição
  e receita de fechamento quando existente, senão PDV. Plano anterior de taxas
  revisado: as referências contábeis já existentes são consultadas, não criadas.
  MDR e antecipação são propostas com parcela, competência e arquivos, sem executar
  o importador antigo que criava despesas. Conta inexistente fica pendente.
  Diferença entre líquido original e pago antecipadamente é hipótese de classificação,
  não taxa comprovada: `net_difference_not_classified`, sempre pendente de origem.
- Caixa: coleções canônicas `transactions` e `expenses`;
  vínculos oficiais antes/depois, um mês e uma conta. Extrato bancário é separado
  de pagamentos informados. Despesas parcialmente pagas usam saldo explícito;
  despesas vinculadas a movimento bancário sem baixa coerente ficam pendentes.
  Taxas já incluídas no líquido não geram nova saída prevista. Parcelas pagas ou
  antecipadas não entram novamente na previsão. Não existe fonte canônica de saldo
  bancário conectada nesta base: posição confirmada permanece nula, sem leitura de
  coleção hipotética nem dedução de saldo a partir de movimentos do período.
- Gerencial: orçamento explicitamente informado, materialidade, comparação de duas
  competências, principais despesas, resultado/margem quando sustentados pela fonte,
  alertas determinísticos e links para investigação. Não foi encontrado cadastro
  canônico de orçamento nesta base; o parâmetro não é apresentado como aprovado.
- Rotinas: configuração administrativa por unidade/StoneCode, diária/semanal,
  revisão otimista, lease e idempotência por revisão/dia. Resultado resumido e
  histórico próprios de análise (não outro livro financeiro), ciência auditável de
  alertas sem resolver a origem. Execução recorrente não baixa novamente 31 arquivos
  Stone: análise Stone continua opção explícita da consulta manual.

## Superfícies e autorização

`/dashboard/financial/cash-flow/agent?topic=management` reúne as análises e rotinas.
Navegação também liga PDV × Stone e preserva Antecipações/Recebíveis existentes.
`PageContainer wide`; cliente autenticado compartilhado; comandos manuais sem polling.
Ao selecionar uma rotina existente, o formulário recupera frequência, habilitação,
orçamento e materialidade salvos, evitando sobrescrever a configuração com defaults.

APIs administrativas: `management-analysis` (somente leitura), `analysis-routines`
(configuração, executar análise e registrar ciência). `requireUser` e administrador
padrão são exigidos no servidor. Permissões anteriores não foram ampliadas e não
há migração de perfis. Coleções de rotinas não têm permissão direta de cliente
nas regras atuais (deny implícito); apenas APIs administrativas escrevem.

Scheduler separado: `POST /api/financial/analysis-routines/scheduler`, desabilitado
por padrão. Requer `FINANCIAL_ANALYSIS_SCHEDULER_ENABLED=true` e segredo exclusivo
`FINANCIAL_ANALYSIS_SCHEDULER_SECRET` no header `x-financial-scheduler-secret`.
Comparação em tempo constante; escopo fixo do servidor; no máximo uma rotina devida
por execução. Nenhum segredo foi criado, lido ou publicado. Nenhum agendamento
externo foi criado. A configuração e ativação exigem etapa autorizada de publicação.

## Preflight de custo e índices

Sem listeners ou polling. Novas consultas são limitadas e específicas:

- Pix: 1 metadado + até 501 linhas de um único arquivo/data/documento, por clique.
  No cenário 1 consulta/h × 1 aba × 8h/dia × 22 dias: teto 88.352 leituras/mês,
  além das leituras de vínculos já existentes. Zero escrita financeira.
- Gerencial: teto conservador de 27 mil leituras por execução, dominado pela fonte
  oficial de duas competências (até 20 mil relatórios/despesas + 5 mil composições).
  Mais até 500 contas referenciadas, 500 movimentos, 500 despesas diretas e vínculos.
  Não há truncamento silencioso: limites excedidos impedem consulta.
  1 execução/h × 1 usuário × 8h × 22 dias: teto 4,752 milhões de leituras/mês.
  Esse é teto de segurança, não estimativa de volume observado em produção.
- Até 20 rotinas/workspace. Semanal: teto 2,322 milhões de leituras/mês para 20
  rotinas × 4,3 execuções × 27 mil; diária: 16,2 milhões para 20 × 30 × 27 mil.
  Não ativar frequência diária em produção sem medir volume/custo e revisar cache
  ou resumos. Cada execução escreve lease, resultado/resumo e histórico; salvar
  e registrar ciência usam transação com auditoria. Não escreve despesas/pagamentos.
- Listagem de rotinas: até 21 documentos, somente por comando. Cadastro novo
  verifica limite 20 em transação. Scheduler consulta uma rotina devida por chamada.
- Índices adicionados para conta/data de movimentos, centro/vencimento de despesas
  e workspace/habilitação/próxima execução. Arquivo de índices não foi publicado.

## Limitações que não devem ser ocultadas

Agenda continua recorte de capturas, não carteira completa. Cancelamentos e
estornos sem origem/histórico completo são evidências pendentes, não compensações
inventadas. Arquivos Pix antigos precisam de reprocessamento autorizado para conter
evidência versionada; não houve backfill. Arquivo Pix por dia pode omitir uma venda
cujo evento seja publicado em outro dia.

Caixa não inclui automaticamente rateios, despesas sem vencimento ou datas legadas
em formato diferente do Timestamp consultado; isso é cobertura parcial, não saldo
final. Conta Stone sem fonte bancária continua sem saldo comprovado. Não se criou
Banking API. Nenhum documento ausente vira comprovante de zero ou carteira vazia.

Orçamento informado não é cadastro aprovado. Comparação de mês aberto versus fechado
exige revisão humana. Classificação de taxa não resolve duplicidade com despesas
existentes; o operador deve conferir antes de lançar. Nenhuma decisão financeira,
antecipação, baixa ou pagamento foi habilitado por este incremento.

## Verificação e ambiente

Testes de domínio para snapshots Pix, matching, DRE, orçamento, cobertura e caixa;
E2E de API para autorização, escopo, análise, rotinas, revisão, idempotência e ciência.
Emuladores `demo-`, dados sintéticos, sem navegador e sem credenciais reais.
Resultado final registrado no plano ao concluir.

Havia outra tarefa usando portas padrão dos emuladores. A verificação desta branch
usa configurações temporárias com portas separadas, removidas ao final. Cache webpack
regenerável do worktree anterior `Coala-OP-pdv-stone-flow` removido para liberar disco;
nenhum fonte, credencial ou dado financeiro foi removido. Mudança alheia em
`Coala-OP-stone-reconciliation-integration/apphosting.yaml` preservada.

### Revisão de retomada — 23/09/2026

Removida a leitura de `bankAccountBalances`: não há integração canônica que produza
essa coleção nesta base. O servidor mantém posição bancária não comprovada, mesmo
quando existem movimentos confirmados. A regressão de pagamento parcial está coberta
no E2E: obrigação de R$ 10, saída bancária de R$ 5 e saldo previsto de R$ 5, sem
duplicação e sem deduzir um saldo bancário final.

Verificação retomada com `NODE_OPTIONS=--max-old-space-size=4096`, em sequência com
os testes de API. Cache webpack regenerável apenas desta branch removido por falta
de espaço. Portas isoladas para não interferir nos emuladores de outra tarefa.

Resultado: `npm run verify` aprovado com o limite de memória acima (1.405 testes,
tipos, lint, contrato de erros, skills e build). Os testes de API `management.spec.ts`
e `pdv-stone-review.spec.ts` passaram: autorização, escopo, pagamento parcial,
conflito de revisão, idempotência e ciência de alertas. A tentativa inicial de API
foi interrompida para executar as verificações em sequência; não foi considerada
aprovação. A execução final completa passou em emuladores `demo-coala-e2e`.

O build gerou avisos de dependências Firebase/protobuf em módulos existentes;
nenhum erro de compilação. Configurações temporárias de portas removidas. Nenhum
deploy, backfill ou ativação do scheduler foi realizado. Acesso continua exclusivo
de administrador padrão, sem alteração de perfis ou regras de acesso.
