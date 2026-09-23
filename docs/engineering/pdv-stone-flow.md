# PDV × Stone — consulta autenticada

Branch `feat/pdv-stone-flow`, base `268c9b23`. Contrato de integração, somente leitura.
O motor puro já existe; faltavam coleta limitada, autorização e apresentação.

## Preflight (antes de implementar as consultas)

Reutilizar `readFinancialAgentMapping`: até 101 documentos de vínculos, filtrados
por workspace e StoneCode, mais unidade e conta. Ler a unidade novamente para
obter a filial PDV armazenada: até 104 leituras por resolução. Resolver antes e
depois da coleta: até 208 por consulta manual, normalmente 8 com um único vínculo.
Estimativa com 2 consultas/hora × 2 usuários × 8 horas/dia × 30 dias:
199.680 leituras/mês no teto; 7.680 no cenário de um vínculo. Autenticação e catálogo
usam os leitores existentes, fora dessa estimativa de dados da comparação.
Zero escritas financeiras; sem polling, listeners ou carregamento automático.

O catálogo existente usa paginação; carregar apenas por ação explícita. A fonte
PDV será limitada a um dia, 8 MiB de resposta e 500 cupons, e a Stone aos limites
do parser/motor vigente. A consulta terá prazo total e não repetirá chamadas.

## Fronteiras

Somente administrador padrão, tanto na navegação quanto na API. Workspace vem
do contexto autenticado. Vínculo Stone precisa estar vigente e não particionado
por terminal. Filial PDV precisa estar cadastrada na unidade: não usar fallback
por nome/ID. Qualquer mudança de vínculo durante a coleta invalida o resultado.
Sem nova permissão, migração, lançamento, fechamento, push ou deploy.

O transporte legado do PDV foi inspecionado: não tem prazo/tamanho máximo, pode
registrar corpo de erro e aceita `{data: valor não-array}` como lista vazia.
Usar um leitor estreito e sanitizado para esta consulta, com os mesmos endpoints
e contrato de autenticação já usados no projeto. Não importar o sincronizador
que também escreve agregados. Reutilizar parser de cupons, canais e motor existentes.
Respostas com envelope/paginação não comprovados serão recusadas, não truncadas.

## Validação

Implementados `POST /api/financial/pdv-stone-review` e a página
`/dashboard/financial/sales-reconciliation`, em Conciliação → Vendas e recebíveis.
A tela usa `PageContainer wide`, o cliente autenticado existente, catálogo paginado
manual e tabelas de sugestões/apontamentos paginadas. Mudar seleção limpa o resultado;
o retorno também precisa corresponder à unidade, vínculo, conta, código e dia escolhidos.
Sem aprovação, compensação de cancelamentos ou soma apresentada como caixa disponível.

Corpo da API limitado por streaming a 2 KiB, com prazo de leitura de 10 segundos.
Autorização ocorre antes de ler o corpo. Consulta dos provedores em paralelo, com
cancelamento ao encerrar/falhar a requisição, teto de 110 segundos e limite PDV de
60 segundos incluindo token e resposta. Não há retry nem redirecionamento HTTP.
Erros de integração são recriados por allowlist; corpos, tokens e mensagens externas
não atravessam a fronteira nem são registrados por este leitor.

Limites preservados: um StoneCode não cobre necessariamente todas as adquirentes;
Pix continua fora da comparação até haver fonte e vínculo de terminal; cancelamentos
Stone são evidências pendentes de histórico. O cadastro de filial PDV é atual, sem
histórico de reassociações comprovado; a revalidação detecta mudanças durante a
requisição, não reconstrói vigências passadas da filial. Não houve chamada aos
provedores reais ou prova de cobertura com dados de produção.

Revisão de permissões: mantido `isDefaultAdmin` na página, item de navegação e rota.
O layout financeiro existente exige `financial.view`; administradores padrão já
recebem essa permissão. Perfis restritos não ganham acesso, inclusive via POST direto.
Sem novas permissões, migrações ou ajustes manuais de perfis.

Testes novos:

- Transporte PDV: endpoints existentes, escopo, credenciais, redirecionamento,
  tamanho declarado/real, UTF-8, JSON, envelopes parciais, cancelamento e sanitização.
- Consulta integrada com HTTP injetado: dois transportes reais, parsers e matching;
  permissão, datas, vínculo, filial, alteração durante coleta e fontes inválidas.
- E2E da API em `demo-coala-e2e`, sem navegador ou credenciais de provedores: 1 teste
  aprovado com múltiplos cenários de autorização/validação e documentos sintéticos.
  Já é coletado pelo job E2E existente em observação (`continue-on-error: true`).
- A interface não passou por inspeção visual/navegador, conforme restrição do projeto.

O disco voltou a ficar cheio durante uma gravação, antes dos testes. Removidos
somente os caches webpack regeneráveis das validações anteriores em
`Coala-OP-receivables-agent-integration` e `Coala-OP-stone-future-receivables`
(cerca de 3,8 GB). Nenhum fonte, commit ou alteração alheia foi removido.

Resultado final: `NODE_OPTIONS=--max-old-space-size=4096 npm run verify` aprovado
(exit 0): tipos, lint, **1.378 testes unitários**, contrato de erros, validação de
skills e build com **172 páginas**. Os 12 testes novos de transporte/consulta também
foram repetidos isoladamente após revisão; o E2E da API passou em duas execuções.
Revisão final de lint da rota/consulta/tela aprovada. A compilação inclui os ajustes
finais de cancelamento, aviso de filial atual e exibição de decimais originais.

Continuam os avisos preexistentes de top-level await em `firebase-rh`, dependência
dinâmica protobuf e arquivo grande de recrutamento. Não foi necessário alterar a
configuração de build neste incremento. Sem publicação ou comprovação com fonte real.
