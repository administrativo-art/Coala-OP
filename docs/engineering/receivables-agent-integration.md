# Recebíveis no Coala Financeiro — integração da consulta por período

## Problema e entrega

A consulta de recebíveis existia em uma rota separada; a reorganização da sidebar
estava em outra branch, e a entrada do Coala Financeiro só abria antecipações.
Este incremento reúne a navegação preparada com a consulta e acrescenta análise
contextual, reutilizando a mesma evidência e os mesmos controles de acesso.

- Fluxo de caixa → Recebíveis abre a conferência por período.
- Fluxo de caixa → Coala Financeiro permite escolher antecipações ou recebíveis.
- As duas entradas de recebíveis montam o mesmo `ReceivablesPage` e chamam o mesmo
  `POST /api/financial/stone-future-receivables`; nenhum cadastro foi duplicado.
- Quatro perguntas cobrem líquido previsto, vencimentos, pagamentos excluídos e
  pendências. A análise é determinística, declarada como tal, sem modelo de IA.
- Cada resposta informa o recorte e sua data de corte, unidade, conta, fonte e coleta.
  Seu botão de evidências filtra a tabela e reinicia a paginação na primeira página.
- A troca de pergunta opera sobre a consulta em memória. Mudança de vínculo, código,
  período ou atualização dos vínculos limpa a evidência anterior.
- Antecipações, extrato em Despesas e faturas mantêm seus fluxos e URLs existentes.

Classificação: integração entre componentes e contrato de apresentação financeira.
Invariantes: uma evidência por consulta; autorização no servidor; valores ausentes
não viram zero; pagamentos excluídos não retornam à previsão; data de corte explícita.

## Comparação com a base anterior

Inspeção da branch `feat/stone-reconciliation-integration` (`5716fc21`), preservando
a alteração não commitada em `apphosting.yaml`:

| Contrato | Base anterior | Leitura atual | Decisão neste incremento |
|---|---|---|---|
| Fonte | Lote canônico fornecido a `prepareStoneFinancialImport` | XML diário obtido pelo transporte Stone existente | Reutilizar o transporte validado; não presumir que lote importado seja posição consolidada. |
| Dinheiro | Inteiros em centavos; bruto − MDR − antecipação + ajuste = líquido | Decimais da fonte com até 12 casas; taxas podem estar ausentes | Preservar a precisão e ausência; não arredondar/importar automaticamente. |
| Recebível | Identidade persistida, revisão, saldo liquidado e estado | Captura/parcela + eventos dentro de intervalo limitado | Reutilização futura exige contrato de identidade, revisões e histórico completo. |
| Efeitos | `importStoneFinancialBatch` grava recebíveis/eventos e pode gerar/cancelar despesas de taxas | Consulta sem escrita financeira | Não conectar o importador a uma consulta de análise. |
| Vínculo | Base antiga inclui seu escritor de mapeamentos | Cadastro atual valida vigência, revisão otimista e auditoria | Manter o escritor atual; comparar contratos antes de habilitar outro. |
| Interface | Lista persistida depende das coleções e permissões antigas | Tabela de eventos e catálogo oficiais já disponíveis | Extrair o componente atual para as duas entradas; não duplicar a consulta. |

Arquivos antigos inspecionados: `stone-receivables/types.ts`, `schemas.ts`,
`identity.server.ts`, `ingestion.server.ts` e `service.server.ts`, sob
`src/features/financial/`. São base para integração posterior, não garantia de
completude dos dados da Stone.

O formatador decimal existente em `agent/presentation.ts` foi reutilizado. As novas
funções de resposta não somam nem recalculam taxas: usam o total exato já validado
por `reviewReceivablePeriod`. Não foi criada outra abstração de transporte ou banco.

## Cobertura que permanece pendente

Consultar até 31 arquivos não reconstrói vendas anteriores ao recorte, eventos de
registradora, cessões ou gravames. Nenhuma das duas bases inspecionadas comprova, por
si, que todo esse histórico foi obtido. A agenda continua identificada como
conferência por período; não alimenta automaticamente o previsto/realizado.

Antes de importar uma posição persistida: validar a fonte e sua cobertura, identidade
por estabelecimento/parcela, precisão e taxas ausentes, revisões, histórico de
pagamentos, escritor único de vínculos e aprovação de efeitos contábeis. A Banking
API permanece fora conforme decisão do usuário; pagamento Stone não confirma banco.

## Permissões e preflight de custo

- Sidebar e componentes: `isDefaultAdmin`; layout mantém `financial.view`.
- API: mantém autenticação, administrador padrão, workspace e revalidação diária
  do vínculo oficial. Parâmetro `topic` só escolhe apresentação; não autoriza leitura.
- Permissões reutilizadas; nenhum perfil exige migração. Extrato e faturas mantêm
  as permissões e controles anteriores.
- Zero consultas extras ao abrir a página ou trocar pergunta, filtro ou página.
  Não há novo listener, polling, cron, coleção ou escrita de negócio.
- Consulta manual mantém o teto de 109 leituras Firestore e 31 chamadas Stone;
  catálogo mantém páginas de 50 + sentinela. Duas abas que executem consultas
  manualmente contam como duas consultas, sem duplicação automática entre entradas.
- Cenário de planejamento: 2 consultas/h × 2 usuários/abas × 8 h/dia × 22 dias =
  704 consultas/mês, até 76.736 leituras e 21.824 chamadas Stone, mais as páginas de
  catálogo carregadas manualmente. Incremento de consultas por resposta: zero.

## Verificação

Os testes de resposta usam XML sintético processado pelo leitor real. Cobrem precisão
do total, exclusão de pagamentos, zero versus ausência, pendências, vencimentos,
evidência filtrada e preservação do resultado original. Testes de navegação mantêm
os destinos antigos e a autorização administrativa.

O teste de API em emuladores `demo-coala-e2e` inclui troca de conta entre duas datas:
mesmo que cada dia tenha vínculo inequívoco, a consulta não pode atravessar a troca.
Não há navegador, credenciais reais ou chamada à Stone nos testes.

Verificação concluída em 22/09/2026:

- 36 testes direcionados aprovados (análise, consulta, navegação e antecipações).
- `NODE_OPTIONS=--max-old-space-size=4096 npm run verify` aprovado: tipos, lint,
  1.345 testes unitários, contrato de erros, skills e build com 171 páginas geradas.
- Quatro testes de API aprovados nos emuladores, incluindo a troca de conta dentro
  do período e as negativas por autenticação, permissão, data e vínculo inválidos.
- Build incluiu as rotas de recebíveis e do agente; permanecem os avisos de
  Firebase/protobuf também presentes na verificação anterior.
- Sem teste visual de navegador; dependências compartilhadas por symlink. CI com
  instalação limpa permanece necessário antes da publicação.
- Entrega local, sem push, deploy, migração ou escrita de dados financeiros reais.
