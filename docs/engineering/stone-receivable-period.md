# Recebíveis: conferência por período, sem saldo disponível presumido

## Contrato e limites

`POST /api/financial/stone-future-receivables` recebe unidade, StoneCode, `from` e
`through` (datas civis inclusivas, máximo 31 dias). Retorna as parcelas de vendas
capturadas no recorte e os pagamentos encontrados nesses arquivos. A página
`/dashboard/financial/cash-flow/receivables` apresenta a conferência, acessível
pelo link no painel de antecipações. Esta entrega é independente da branch de
reorganização da sidebar; não modifica essa branch nem antecipa sua publicação.

**Não é posição completa de recebíveis nem saldo disponível.** A integração atual
é de eventos diários. Não há fonte validada para a posição consolidada da carteira,
cessões, gravames e registradora. O painel não alimenta automaticamente o fluxo
previsto/realizado, não altera recebíveis persistidos e não cria novas coleções.
Pagamento na Stone nunca implica confirmação no banco.

Invariantes:

- Cada parcela é identificada por transação + número dentro do mesmo StoneCode.
- Um arquivo idêntico repetido não duplica parcelas; revisões conflitantes bloqueiam.
- Pagamento integral compatível tira a parcela da previsão, inclusive antecipação.
- Pagamento parcial, cancelamento, chargeback, reversão, moeda/datas incompatíveis,
  captura incompleta ou eventos duplicados ficam pendentes; não se subtrai líquido
  pago do líquido original para inventar um saldo residual.
- Arquivos ausentes bloqueiam previsão das parcelas sem pagamento; total fica nulo.
- Arquivo vazio não prova saldo zero. Vencidas sem pagamento são separadas do futuro.
- Pagamentos de vendas anteriores ao recorte são contados como fora do escopo,
  jamais subtraídos das vendas do período.
- Total projetado, quando disponível, é somente das parcelas futuras elegíveis do
  recorte; MDR não é subtraído novamente. Precisão decimal de 12 casas com BigInt.
- Fonte/data/arquivos, pendências e limitações são exibidos; vigência é validada no servidor.

## Permissões e segurança

Somente administrador padrão na página e API; layout mantém `financial.view`.
Cada dia do período resolve o mesmo vínculo oficial, sem mudança histórica de conta,
ambiguidade ou partição por terminal. Unidade e conta revalidadas no servidor.
Contrato estrito, limite de corpo 2 KB, no-store, deadline de 110 segundos,
erros sanitizados. Credencial apenas no backend em execução. Sem chamada ao modelo.
Sem baixa, classificação, importação, lançamento na DRE ou atualização de extrato.

## Preflight de custo

Consulta manual: até 101 vínculos + duas referências + autenticação (estimativa
conservadora 109 leituras, reservando seis para autenticação). Todos os dias são validados em memória com uma única
consulta de vínculos. Mesmo índice workspaceId + stoneCodes já existente.
Até 31 chamadas Stone sequenciais, arquivo limitado a 8 MB pelo transporte existente
e máximo de 5.000 registros (transações + parcelas) retidos no período. Ultrapassar
o limite solicita período menor, sem truncar silenciosamente. Sem cron/polling.
Exemplo de uso: 2 consultas/h × 2 administradores × 8 h/dia × 22 dias = 704 consultas,
até 76.736 leituras/mês e 21.824 chamadas Stone; é teto de planejamento, não medição.
Carregar vínculos: páginas de 50 + sentinela por ação explícita (até 57 leituras com autenticação).
Paginação e filtros da tabela são locais, sem chamadas extras à Stone.

## Fontes técnicas consultadas em 22/09/2026

- https://conciliacao.stone.com.br/reference/extrato-da-agenda-stone
- https://conciliacao.stone.com.br/reference/novo-extrato-agenda-stone

Os dois endpoints documentam arquivos por data de referência, disponibilizados
após as 05h do dia seguinte. O endpoint novo troca os identificadores por
paymentProfileId/poiType; não foi tratado como um snapshot completo da carteira.

## Validação e próximo passo

Testes de regras com XML sintético e E2E de autorização em emuladores demo, sem
credenciais reais. O endpoint nega anônimos, usuários restritos, datas inválidas,
ausência de vínculo e vínculos por terminal antes de acessar o provedor.

Verificações executadas em 22/09/2026:

- `node --import tsx --test tests/unit/stone-receivable-period.test.ts`: 17 testes aprovados.
- `tests/e2e/financial/stone-agenda.spec.ts`, pelo runner do projeto com emuladores
  `demo-coala-e2e`: quatro testes de API aprovados, incluindo recebíveis futuros.
- A primeira execução de `npm run verify` esgotou o heap padrão do Node durante
  `tsc --noEmit`; `NODE_OPTIONS=--max-old-space-size=4096 npm run verify` passou:
  tipos, lint, 1.333 testes unitários, contrato de erros, skills e build de produção.
  A página e a API novas constam na saída do build. Houve avisos de importação
  dinâmica de dependências Firebase/protobuf, sem falha de compilação.

Para declarar carteira completa, falta validar uma fonte de posição consolidada
ou um histórico integral e reconciliado com os eventos de registradora. Não ampliar
o título/indicador para "saldo disponível" antes de resolver essa cobertura.
