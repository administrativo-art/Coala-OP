# PDV × Stone — adaptação de fontes e motor de sugestões

## Escopo deste incremento

Branch `feat/pdv-stone-review`, base `7e20c0aa`. Incremento de domínio, sem tela,
rota pública, consulta a produção, persistência ou publicação. A etapa PDV × Stone
do plano continua **parcial**: o motor agora recebe envelopes de cupons e XML real
do contrato vigente, mas a coleta autenticada e a apresentação ainda não foram conectadas.

Classificação: contrato entre fontes e regra financeira. Invariantes: coincidência
não é confirmação; ausência no recorte não é ausência de venda; centavos não podem
ser obtidos por arredondamento silencioso; movimentos de conta não são capturas.

## Reaproveitamento e correções

`matching.ts` e os tipos estritamente necessários vieram de
`feat/stone-reconciliation-integration` (`5716fc21`, implementação `e302b2b3`).
Não foram trazidos persistência, decisões, projeção de caixa ou escritores de taxas.
O worktree anterior e sua alteração em `apphosting.yaml` ficaram intactos.

Diferenças intencionais em relação ao motor anterior:

- Todas as sugestões permanecem `pending_review`, inclusive as de chave forte.
- Valor + horário tem confiança média, nunca aprovação automática.
- Identificadores mantêm pontuação, caixa e zeros à esquerda; chaves compostas
  usam arrays JSON para não colidir quando um identificador contém separadores.
- Cupom PDV não é presumido como referência de pedido Stone. Esse caminho exige
  `merchantOrderId` explícito nas duas fontes.
- Duplicidade de IDs rejeita a entrada; multiplicidade de chave forte é ambígua.
- Identificadores fortes contraditórios impedem fallback por valor/horário.
- Valores, datas, estados, fonte e limites são validados antes do matching.
- Unidade desconhecida e estado pendente não permitem correspondência confirmada.

## Adaptação das fontes

`reviewDailySales` é uma função pura. Seu chamador **deve** autenticar e validar os
vínculos workspace/unidade/filial PDV/StoneCode antes de fornecer os payloads.
O escopo passado à função não comprova autorização nem titularidade da filial.

O XML é validado pelo parser existente, inclusive StoneCode, dia, versão e duplicidades.
Somente capturas de `FinancialTransactions` com moeda BRL, data local do recorte e
valor positivo exato em centavos viram fatos de venda. Débito e pré-pago débito
usam códigos 1/3; crédito e pré-pago crédito, 2/4, conforme o
[contrato AccountType Stone](https://conciliacao.stone.com.br/reference/accounttype).
Outros códigos ficam pendentes. Movimentos da seção de contas não duplicam receita.

Conforme o [contrato Transaction](https://conciliacao.stone.com.br/reference/transaction-1),
eventos dizem respeito ao dia do arquivo e detalhes da captura podem estar ausentes
nos outros eventos. Cancelamentos, estornos e chargebacks não são compensados como
novas vendas negativas: ficam nas evidências, com IDs, valores e contadores originais.
Um evento adverso em qualquer seção bloqueia a captura da mesma transação nesse arquivo.
Isso não equivale a reconstruir o histórico completo da venda.

No PDV, foram reutilizados o parser do fechamento e a normalização central de canais,
com validação anterior dos campos tolerantes: sem ID, valor ausente, divergência entre
total e pagamentos, duplicidade e data inválida viram pendências explícitas. Valores
monetários vêm dos campos brutos validados, sem round-trip pelo `number` do parser.
Dinheiro/troco participa apenas da validação do total; pagamentos digitais mantêm
índice e cupom. Cancelamento parcial de item não vira cancelamento total do cupom.
Não foi inventado um campo NSU/autorização/terminal no PDV nem uma equivalência entre
status do cupom e aprovação da adquirente: estado desconhecido permanece pendente.

Pix PDV aparece em `uncomparedPdvFacts`, não como venda ausente na Stone. A fonte Pix
é separada do XML e ainda exige associação comprovada de terminal à unidade. O
arquivo corporativo não pode ser atribuído integralmente a uma unidade por conveniência.

## Limites, custo e permissões

- Um dia e um StoneCode; sempre `coverage: partial` e `bankReceiptConfirmed: false`.
- Até 500 cupons, 500 fatos de pagamento PDV e 500 eventos Stone; excesso rejeita
  integralmente, sem truncar uma comparação silenciosamente.
- Até 100 meios de pagamento por cupom. Busca temporal limitada a cinco minutos.
- Valores com fração não nula além de centavos ficam pendentes, sem arredondamento.
- O PDV pode conter outras adquirentes; um lado sem par não prova falta no outro.
- Nenhuma query, polling, listener, gravação ou chamada externa nova. Preflight
  Firestore: **0 documentos × 0 execuções × usuários × dias = 0 leituras/escritas**.
- Nenhuma alteração de permissões, navegação ou fluxo público. Não há migração.
  A futura API terá de reutilizar autorização administrativa no servidor e revalidar
  os vínculos após a coleta; esta função pura não substitui esse controle.

## Validação e continuidade

Testes permanentes em `tests/unit/pdv-stone-daily-review.test.ts`: XML + cupons,
centavos exatos, escopo, ausência de fonte, Pix, aliases, duplicidades, pagamento
dividido, troco, datas, cancelamentos, eventos de conta, tipos de cartão, limites,
conflitos de identificadores, ambiguidades e isolamento de unidade/workspace.
Fixtures sintéticas do contrato; não foi feita comprovação contra dados de produção.

Não foi criado E2E neste incremento: não existe nova rota nem mudança em fluxo
crítico acessível. O próximo incremento deve conectar coleta limitada, autorização,
resolução de filial e vínculo Stone, tela de evidências e E2E de API em emuladores.
Antes de chamar o PDV, revisar timeout/tamanho máximo do transporte existente e a
sanitização de erros; não reutilizar o sincronizador que escreve vendas/agregados.

Validação executada:

- 21 testes novos aprovados, incluindo o recorte denso de 500 fatos de cada lado.
- `npm run check` (dentro de `verify`): tipos, lint, **1.366 testes**, contrato de
  erros e skills aprovados. Nenhum teste ignorado.
- A primeira execução de `verify` falhou no build com `ENOSPC`: havia apenas
  116 MB livres no volume. Não foi falha de teste ou erro de código reportado.
- Após autorização, removidos somente 518 MB de cache webpack gerado neste
  worktree. Repetido `npm run build` com 4 GB de heap e cache persistente desligado
  temporariamente: **exit 0**, 171 páginas geradas. A alteração temporária de
  configuração foi removida e não faz parte do commit.
- Avisos conhecidos de `firebase-rh` (top-level await), dependência dinâmica de
  protobuf e arquivo grande de recrutamento continuam; não foram alterados.

O comando `verify` com cache normal não teve uma segunda execução verde; o check
e a compilação sem cache foram validados separadamente. A máquina continua com
pouco espaço livre. Nenhum arquivo do usuário ou cache de outra branch foi removido.
