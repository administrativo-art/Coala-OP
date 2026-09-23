# Evidências estritas de eventos Pix

Branch `feat/stone-pix-events`, base `5e198f71`. Contrato de integração isolado,
sem ativar comparação Pix no PDV ou movimentação financeira.

## Comportamento anterior e regra

O parser legado arredonda centavos fracionários e converte valores ausentes em zero.
IDs de linhas incluem posição no arquivo, de modo que replays têm IDs diferentes.
Esses campos e o resumo legado não comprovam vendas únicas e não devem alimentar
a conciliação. A compatibilidade foi preservada, sem corrigir valores por suposição.

Acrescentada `reviewEvidence.version = 1` a cada linha, com evento, E2E, refund,
timestamps UTC preservados com até seis casas e valores exatos já em centavos.
Valores ausentes, negativos, fracionários, em notação científica ou acima do limite
aritmético conservador são inválidos, nunca arredondados ou substituídos por zero.
Novos consumidores devem exigir essa versão; documentos históricos não a possuem.

A [estrutura oficial](https://conciliacao.stone.com.br/reference/estrutura-do-arquivo-pix)
distingue ID do evento, E2E, valor da operação e timestamps UTC. O
[exemplo público](https://pub-027e93dcf57742efaa5492a7be1efe5e.r2.dev/exemplo-arquivo-conciliacao-pix-stone.csv)
consultado em 2026-09-22 contém operações `pay`/`cancel` e microssegundos. Outras
operações não são inferidas nem normalizadas para pagamento por semelhança.
O exemplo omite a zona em `provider_datetime`: esse campo recebe `Z` explicitamente
conforme sua semântica UTC documentada, sem usar o timezone local da máquina.

Um candidato exige identidade StoneCode reconhecida, IDs válidos, datas válidas e
ordenadas sem perder microssegundos, meio Pix, evento `pay`, status `paid`, captura
positiva igual ao pago e ao valor da operação, cancelado zero e taxa não superior
à captura. Qualquer evidência de cancelamento/refund impede candidatura. Duplicidade
de evento ou E2E no arquivo bloqueia todas as linhas relacionadas, em qualquer ordem.
Isso é deliberadamente conservador: não decide qual evento prevalece.

`candidateForReview` é apenas elegibilidade de origem. Não resolve unidade/conta,
não confirma saldo bancário, não aprova conciliação e não comprova ausência de
cancelamento em outro arquivo. O resumo legado continua separado e não é agregado
financeiro de vendas únicas. Não houve reprocessamento histórico.

## Escopo, testes e próxima etapa

Reutilizado o parser CSV, sem novas importações de produção ou abstração global.
Testes permanentes reproduzem arredondamento legado, ausência monetária, cancelamentos
integrais/parciais, refund, replay, colisão de E2E, ordem de eventos, timestamps,
identificadores e exclusão de dados sensíveis. Não há novo fluxo de usuário que
exija E2E neste incremento. Resultado da verificação geral registrado no plano.
Leitura do exemplo público: 29 linhas, quatro candidatas e 25 sem identidade de
unidade reconhecida; duas linhas com evento/E2E repetido e uma com cancelamento
também foram sinalizadas. Não houve consulta a transações reais do Tirirical.

Nenhuma query, listener, polling, rota ou permissão nova. Custo incremental:
zero leituras/documentos escritos adicionais; metadados pequenos acompanham as
escritas já existentes do webhook. Nenhuma consulta de conta real ou credencial,
publicação, migração ou escrita em produção. Nenhum script temporário no repositório.

Próximo incremento: leitor limitado e consistente de uma geração Pix, validação
de documento/workspace e vínculo oficial por StoneCode, adaptação ao motor e à API
administrativa existente, evidências na tela e E2E em emuladores. Verificar cobertura
do arquivo antes de usar os flags de duplicidade; não recalculá-los em subconjunto
filtrado que possa esconder eventos relacionados.
