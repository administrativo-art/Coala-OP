# Consulta administrativa da agenda Stone

## Contrato e escopo

`GET /api/financial/stone-agenda?stoneCode=...&referenceDate=YYYY-MM-DD`

Consulta manual, somente leitura, de um arquivo diário XML2_2 pela API v2.
Requer Firebase ID token e `isDefaultAdmin` confirmado por `requireUser`.
Não expande permissões de perfis financeiros restritos. Não há nova página,
item de menu, cron, listener ou gravação de dados de negócio.

O StoneCode é explícito; esta consulta administrativa não presume associação
com uma loja. O serviço da Stone também valida a titularidade da chave em relação
ao código. A evolução para usuários por unidade precisa usar o mapeamento oficial
`stoneMerchantMappings` e as permissões da implementação de conciliação já existente,
sem criar um segundo cadastro. Não se publica a outra branch junto desta entrega.

O backend lê `STONE_CONCILIATION_API_KEY`, já provisionada via Secret Manager.
O segredo não passa por navegador, parâmetros da API ou scripts locais.

## Resposta

- Header validado contra código, data e layout solicitados.
- Transações e parcelas separadas pelas seções de eventos/previsão e liquidação.
- `expectedPaymentDate` não equivale a `paymentDate`; `bankReceiptConfirmed`
  permanece false porque esta fonte não confirma conciliação com extrato bancário.
- Valores decimais preservados em strings, sem conversão pelo parser de centavos
  do CSV Pix. MDR e SaleFee ausentes continuam null. Não inferir taxa contratada
  nem tratar diferença bruto/líquido como MDR comprovado.
- Identificadores preservam zeros à esquerda. Dados de cartão, titular e conta
  bancária não são retornados. XML bruto e erros do provedor não são expostos.
- Limite de 100 transações por padrão, máximo 200, com `nextOffset` explícito;
  `transactionId` permite filtrar exatamente. O arquivo é diário, não uma agenda
  completa de todos os saldos abertos; eventos financeiros fora das seções de
  transações não são contabilizados nesta visualização.
- Falhas, dados inválidos, outra loja/data, 404 e credencial rejeitada são erros,
  nunca zero financeiro. Timeout 120 s, sem retry automático, máximo 8 MiB
  descomprimidos. Redirect é solicitado como false e bloqueado se ainda ocorrer.

## Preflight de custo e permissões

Sem queries adicionais ao Firestore além da autenticação existente (até duas
leituras de documentos de usuário/perfil por solicitação). Uma requisição Stone
por chamada, nenhuma escrita de negócio. Exemplo de uso manual: 10 consultas/dia
por um administrador = até 600 leituras de autenticação e 300 requisições Stone/mês
de 30 dias, fora logs técnicos. Sem polling. Paginar faz nova consulta do arquivo.

Permissões: nenhum novo perfil/claim, nenhuma migração, nenhum relaxamento de regras
Firestore. Usuários não administradores são barrados antes da chamada externa.

## Verificação

Testes unitários de transporte, parsing, escopo, privacidade, datas, precisão,
paginação e autorização: `node --import tsx --test tests/unit/stone-agenda-*.test.ts`.
E2E API-only em `tests/e2e/financial/stone-agenda.spec.ts`: emuladores demo, sem
chave real e sem navegador; testa 401 anônimo, 403 restrito e 400 para data inválida
com administrador. O CI executa `npm run verify` e o E2E em observação antes da
publicação. O teste real autorizado será executado somente no backend implantado.

## Fontes oficiais do contrato

- https://conciliacao.stone.com.br/reference/extrato-da-agenda-stone
- https://conciliacao.stone.com.br/reference/exemplo-de-arquivo-layout-2-2
- https://conciliacao.stone.com.br/reference/transaction-1

Nenhum exemplo sintético de taxa ou vencimento dos testes descreve o contrato da Coala.
