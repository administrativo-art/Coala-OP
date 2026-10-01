# Navegação financeira: conciliação sem migração de dados

Mudança de organização de navegação, não de regra financeira. A auditoria do extrato
continua em `/dashboard/financial/expenses?view=audits`, usando o mesmo
`FinancialImportPage` embutido, sessões, vínculos, modais e APIs. Acesso antigo por
Despesas e `/expenses/import` permanece. Não há redirecionamento ou migração.

Conciliação agrupa Extrato bancário, Faturas de cartão, **Conciliação de vendas** e
**Conciliação de recebimentos**. As duas conciliações são entradas independentes e
não mantêm atalhos recíprocos nos cabeçalhos. Vendas compara PDV × Stone e abre nas
divergências; Recebimentos reúne carteira, antecipações e taxas praticadas sem tratar
pagamento Stone como crédito bancário. Fluxo de caixa fica imediatamente abaixo,
com Visão do caixa, Recebíveis e Coala Financeiro.

Faturas de cartão mantém o destino em Contas a pagar e recebe uma segunda entrada
em `/reconciliation/card-statements`, reutilizando `CardStatementsPage`. O agente
e Antecipações reutilizam `StoneAnticipationsPage`, sem duplicação de cadastros.

## Permissões e custo

- Extrato: `financial.audits.view`; ações continuam nas permissões atuais da auditoria.
- Faturas: `financial.cardStatements.view`; importar, auditar, fechar e conciliar
  continuam exigindo as permissões específicas existentes no componente e APIs.
- Vendas, Conciliação de recebimentos, antecipações e agente: administrador padrão, tanto nos componentes quanto nas APIs.
- Visão do caixa: permissões existentes `cashFlow.view`/`financialFlow`.
- Layout Financeiro mantém `financial.view`. Nenhuma nova permissão ou migração.
- Zero queries, listeners, polling ou escritas adicionados à sidebar. Ao abrir Vendas
  ou Recebimentos, a página ativa executa uma consulta limitada a 51 documentos e
  exibe até 50 vínculos; páginas seguintes e atualização são manuais. Com três vínculos,
  um administrador abrindo a página dez vezes por dia representa cerca de 900 leituras
  mensais; no teto da página, 15.300. Taxas e consultas externas só carregam após a
  seleção e a ação do usuário.

## Verificação

Testes unitários protegem ordem, destinos, permissões, links legados e destaque por
query string (incluindo URLs com sessão/ledger). A lógica de importação, os vínculos,
as transações, a efetivação, as APIs e as regras Firestore não foram modificados.
Não há novo fluxo financeiro multietapas: apenas entradas para os mesmos componentes.
Validação local: `npm run verify` aprovado (tipos, lint, 1.320 testes unitários,
contrato de erros, skills e build com 170 páginas geradas). Onze testes específicos
de navegação/antecipações também passaram. Permanecem os avisos preexistentes de
`firebase-rh.ts` (top-level await) e protobuf (dependência dinâmica).
Dependências compartilhadas por symlink; CI com instalação limpa ainda deve rodar
antes da promoção. Não houve teste de navegador nem acesso a dados de produção.
Esta mudança não autoriza deploy.
