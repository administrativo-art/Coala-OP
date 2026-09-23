# Consulta de posição de carteira Stone — layout 2.4

Branch `feat/stone-wallet-position`, base `a8367419`, em 23/09/2026.
Classificação: integração e contrato de fonte. A leitura anterior exige XML2_2 e
interpreta eventos de transações, sem WalletPosition. Não havia consulta do 2.4
exposta pelo backend existente. A existência do layout 2.4 na documentação corrige
a hipótese de que seria necessário pedir primeiro outro endpoint à Stone.

## Evidência e limite semântico

A documentação pública descreve WalletPosition como a posição de saldo por
carteira no dia. WalletNatureId distingue agenda normal (1), garantia (5), cessão
(7) e cessão para antecipação com a Stone (8). Category não tem uma enumeração
completa explicada nessa página; o campo é preservado sem inferir disponibilidade.

FinancialTransactionsExpected e FinancialEventsExpected descrevem itens que estavam
previstos e não foram pagos. Não são documentados como inventário de todos os
vencimentos futuros. Portanto, nem essas seções nem WalletPosition, por si só,
comprovam carteira integral ou saldo bancário. Não somar categorias e naturezas
indiscriminadamente, nem descontar novamente antecipações desses valores.

Fontes oficiais consultadas:

- [Endpoint e layouts aceitos](https://conciliacao.stone.com.br/reference/extrato-da-agenda-stone)
- [WalletPosition](https://conciliacao.stone.com.br/reference/walletposition)
- [WalletNatureId](https://conciliacao.stone.com.br/reference/walletnatureid)
- [Estrutura 2.4](https://conciliacao.stone.com.br/reference/layout-2-4)
- [Transações previstas e não pagas](https://conciliacao.stone.com.br/reference/financialtransactionsexpected-layout-24)
- [Exemplo público completo](https://conciliacao.stone.com.br/reference/arquivo-completo-layout-24-1)

## Implementação

`GET /api/financial/stone-wallet-position?stoneCode=...&referenceDate=YYYY-MM-DD`
com offset opcional e limit padrão 100, máximo 200. Leitura administrativa explícita
por StoneCode, sem inferir unidade ou conta pelo nome/chave. Reutiliza a autorização
da consulta administrativa de agenda, o cliente de transporte e a regra de data
publicada. Não cria cadastro, página, cron ou persistência financeira.

O transporte aceita seleção interna por allowlist XML2_2/XML2_4, mantendo 2.2 como
padrão para todos os consumidores anteriores. A nova rota fixa XML2_4 no servidor;
o cliente não pode alterar layout, host, credenciais ou parâmetros desconhecidos.
Reutiliza o segredo injetado em runtime pelo Secret Manager; não exporta seu valor
para CLI, navegador ou logs. Nenhuma chave foi lida ou consultada nesta implementação.

O parser anterior só compreende 2.2 e permanece intacto. O parser novo valida
Header, StoneCode/data/layout, datas civis, posição e linhas de WalletPosition.
Preserva decimais de até 12 casas e sinais. Rejeita duplicatas por arranjo/natureza/
categoria, estrutura inválida, DTD/entities e excesso de tamanho ou de linhas.
Outras seções do XML não são interpretadas nem devolvidas; o sucesso valida esta
projeção, não todos os eventos financeiros do documento.

Limites: 8 MiB descomprimidos, 500 posições, deadline da rota 110 segundos,
paginação explícita e sem truncamento silencioso do arquivo. A resposta inclui
identificação da fonte, hash do XML para detectar revisões entre páginas, timestamp
do provedor e da coleta. Quem consumir várias páginas deve comparar sourceHash e
reiniciar a leitura se ele mudar. Nenhum XML bruto, cartão ou conta bancária é exposto.

Ausência da seção (`not_provided`), seção vazia (`empty`) e posição informada
(`reported`) são estados diferentes. Natureza desconhecida permanece `unknown`,
com contagem explícita. Nenhum desses estados ativa portfolioBalanceConfirmed ou
bankReceiptConfirmed; availableBalance permanece nulo. Não há total agregado que
misture garantias/cessões com carteira normal. Falhas nunca viram saldo zero.

## Permissões e custo

Somente administrador padrão autenticado. Sem mudança de perfis, regras Firestore,
menus ou permissões herdadas. Parâmetros estritos, duplicatas de URL rejeitadas,
resposta no-store e contrato central de erros sanitizados. O E2E verifica bloqueio
de anônimo/restrito, data impossível/futura, layout injetado, paginação excessiva e
StoneCode duplicado antes de qualquer chamada ao provedor.

Nenhuma query de negócio adicional. Preflight: até duas leituras da autenticação
existente × uma consulta/hora × um administrador/aba × oito horas/dia × 22 dias =
até 352 leituras/mês e 176 chamadas Stone/mês. Cada página solicita novamente um
arquivo; multiplicar pelos acessos/páginas reais. Zero escrita financeira. Sem
polling, listener, agendamento ou novo índice. A consulta real inicial será de um
dia e um StoneCode, sem backfill histórico.

## Validação e próximo passo

19 testes específicos de transporte, parser e query aprovados. O parser foi
executado também contra o exemplo XML público oficial: layout 2.4, seis posições,
carteiras normal e de cessão reconhecidas, sem natureza desconhecida. Essa execução
não usou credenciais reais nem comprova acesso ou valores do Tirirical.

As rotas anteriores desta base usam layout 2.2 fixo; consultar o 2.4 com a
credencial mantida no servidor exige publicar esta rota. Não foi feito deploy nesta etapa. Depois da
publicação autorizada, consultar um dia disponível do Tirirical e comparar a
posição informada com os relatórios da Stone. Contatar a Stone apenas se acesso,
categorias, horizonte dos saldos ou vínculos de contratos continuarem ambíguos.
O acesso à carteira integral por vencimento continua como critério a comprovar,
não como funcionalidade entregue apenas pela existência de WalletPosition.

Verificação final: `npm run verify` aprovado, incluindo typecheck, lint, 1.416
testes unitários, contrato de erros, validação de skills e build. O build emitiu
avisos em firebase-rh (top-level await) e protobufjs (dependência dinâmica), fora
dos arquivos alterados. Cinco testes de API passaram em emuladores demo, sem abrir
navegador nem consultar a Stone real. Revisão de queries: nenhum novo listener,
polling ou acesso a coleção; só autenticação existente. `git diff --check` aprovado.
