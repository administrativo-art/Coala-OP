# Rollout da sessão de contagem e dos malotes de depósito

Status: o fluxo original foi publicado em 29/08/2026. A evolução de 31/08/2026 — lock global por unidade, data escolhida dentro da sessão, autosave do modal e moedas devolvidas ao caixa — integra esta promoção. Em 01/09/2026, o novo preflight somente leitura concluiu sem bloqueios, truncamento, sessões abertas ou locks pendentes.

## Resultado do rollout de 29/08/2026

- Código integrado sobre a `main` `ac6df139` e publicado a partir do commit `20e6f33b2bfa423f8aca8cce6850d50be608abf7`.
- App Hosting publicado no build/rollout `build-2026-08-29-003`; revisão anterior para rollback: `studio-build-2026-08-29-002`.
- Regras e índices do Firestore publicados. Os quatro índices de estoque, o índice da DRE em `salesReports` e o índice financeiro de `cashClosures` chegaram ao estado pronto antes da aplicação.
- Functions `cashClosureSummaryWritten` e `cashClosureSummaryReinforcement` atualizadas e confirmadas como `ACTIVE`.
- Gatilho legado `cashClosureLineWritten` removido após a ativação das substitutas, evitando processamento duplicado.
- Dry-run de permissões: 7 perfis examinados e nenhuma alteração necessária.
- Dry-run de campos Inter dos depósitos: nenhum depósito legado encontrado e nenhuma alteração necessária.
- Política `coala_2026_08 = dre_only` já estava aplicada com a justificativa esperada; a execução permaneceu idempotente e sem escrita.
- Preflight do PDV em 28/08/2026: Tirirical com 115 cupons e R$ 1.382,50; João Paulo com 66 cupons e R$ 661,00; sem cancelamentos ou estornos.
- Smoke HTTP: login respondeu `200`; APIs de fechamentos e depósitos responderam `401` sem autenticação, confirmando a proteção das rotas.
- Nenhuma cobrança bancária foi emitida durante o rollout.

Verificações executadas e verdes: `npm run verify`, `npm run check`, `npm run check:rules`, `npm run test:integration`, build das Functions e `npm run validate:cash-closure -- all 2026-08-28`.

## Contratos protegidos na evolução de 31/08/2026

- A sessão nasce somente com as unidades; data e competência entram quando um operador é finalizado.
- Uma unidade pertence a no máximo uma sessão aberta, independentemente da data ou competência.
- Inclusão e retirada de operador atualizam, na mesma transação, quantidade e totais de dinheiro contado, elegível e `dre_only`.
- Contadores por unidade/competência e por data removem escopos obsoletos quando um operador é reaberto. Sessões legadas sem essa versão permanecem identificadas pelo preflight.
- Encerrar a sessão usa os agregados transacionais, não uma listagem limitada de operadores.
- A lista visual de operadores é paginada em até 100 itens por página.
- Competência `dre_only` permanece na DRE e não gera malote.
- O físico precisa conferir exatamente com o valor elegível antes da formação dos malotes.
- Somente cédulas formam malotes de até R$ 5.000; R$ 1 e centavos são registrados como retorno ao caixa/fundo de troco.
- Uma sessão composta somente por moedas conclui sem criar malote bancário. O endpoint de troca permanece apenas para dados legados.
- O modal salva somente linhas sujas após 800 ms, serializa versões e invalida respostas pertencentes a outra unidade/data.
- Após a confirmação física, correções preservam o histórico e geram ajuste de depósito.

## Preflight de custo do Firestore

Não foi introduzido polling, `setInterval` ou listener em tempo real. As leituras abaixo acontecem por navegação ou ação explícita.

### DRE

O endpoint filtra no Firestore somente as unidades autorizadas solicitadas, pagina `salesReports` em páginas de 500 e aplica teto explícito de 5.000 documentos por competência. Ele busca por referência somente as `productSimulations` efetivamente usadas e lê no máximo 20 unidades × 6 competências = 120 resumos de fechamento. Se o teto for ultrapassado ou uma ficha estiver ausente, a DRE não oculta a lacuna; a exportação é bloqueada.

Fórmula por carregamento:

```text
R = relatórios retornados nas seis competências
S = fichas únicas referenciadas
C = unidades × competências, limitado a 120
leituras = R + S + C
```

Cenário operacional conservador, com 20 unidades, um relatório diário por unidade, seis competências e 500 fichas únicas:

```text
R = 20 × 31 × 6 = 3.720
S = 500
C = 20 × 6 = 120
total por carregamento = 4.340 leituras
```

Com 0,5 carregamento por hora, 3 usuários/abas, 8 horas por dia e 30 dias:

```text
4.340 × 0,5 × 3 × 8 × 30 = 1.562.400 leituras/mês
```

A resposta do endpoint inclui as contagens reais em `stats`, permitindo substituir a estimativa pela medição pós-rollout. Trocar o mês gera novo carregamento; manter a página aberta não gera leituras periódicas.

### Visão geral das sessões

A visão geral executa duas consultas limitadas: sessões abertas e sessões recentes, no máximo 25 documentos cada. Teto por carregamento: 50 leituras.

```text
50 × 0,5 × 3 × 8 × 30 = 18.000 leituras/mês
```

### Abertura, autosave e composição da sessão

- Abertura: até 12 unidades no banco principal, 101 sessões abertas, 12 locks globais e até 12 sessões referenciadas por locks. Teto conservador: 137 leituras por ação; sem locks antigos referenciados, até 125.
- GET de fechamento dentro da sessão: acrescenta dois lookups limitados de lock (global e legado), além da leitura limitada do fechamento.
- Autosave: uma transação após 800 ms sem digitação, sem polling. No teto operacional, lê 1 fechamento + 351 linhas + 51 operadores + sessão/locks quando o contado muda, chegando a aproximadamente 406 leituras. Alterações de valor ainda podem atualizar os resumos síncrono e de reforço, até aproximadamente 64 leituras adicionais. Alterações somente de observação não atualizam os resumos; o cliente envia somente linhas sujas e o repositório não regrava operadores inalterados.
- Painel de depósitos: a fila física lê no máximo 51 sessões por carregamento e devolve as 50 mais antigas. A 51ª apenas sinaliza `hasMore`; não derruba a página. Quando o redirecionamento informa `sessionId`, há no máximo uma leitura pontual adicional para garantir a presença daquela sessão na composição, mesmo com fila maior. A consulta só ocorre para quem possui `cashDeposits.view` e `cashDeposits.issue`, e usuários sem `cashClosures.reopen` consultam apenas sessões próprias.

Fórmula para substituir o teto por volume medido:

```text
leituras mensais de autosave ≈ saves por sessão × sessões por mês × leituras reais por save
```

Medir separadamente saves que mudam valores e saves que mudam apenas justificativas antes de ajustar a frequência ou o repositório.

### Detalhe da sessão

A primeira página lê um documento da sessão e até 101 documentos de operador para determinar se há próxima página: teto de 102 leituras. Cada página adicional lê até 101 documentos. Os totais financeiros não dependem dessas páginas.

```text
102 × 0,5 × 3 × 8 × 30 = 36.720 leituras/mês, sem páginas adicionais
```

### Detalhe do fechamento

O fechamento lê no máximo 351 linhas e 51 operadores para detectar estouro dos tetos operacionais de 350 linhas e 50 operadores, falhando antes de calcular com dados parciais. O detalhe não carrega mais a coleção completa de usuários para resolver fotos: consulta, em lotes de até 30 valores, apenas os vínculos dos operadores e usa nome exato somente como fallback. Cada consulta de vínculo ou nome falha acima de 100 usuários candidatos, sem truncamento silencioso. Não há listener nem atualização periódica.

### Depósitos e relatório

As listagens operacionais permanecem limitadas a 500 blocos, cobranças e ajustes pendentes. Um bloco aceita no máximo 500 itens na leitura. O relatório lê no máximo 1.001 fechamentos e 10.001 linhas para detectar estouro; acima de 1.000/10.000 ele falha de forma visível, em vez de apresentar um histórico parcial como se fosse completo. Como o relatório ainda é histórico e acionado sob demanda, atingir esse teto exige evoluir o contrato para filtros de período e paginação antes do rollout seguinte.

### Resumos e jobs

O gatilho por linha foi removido porque todas as escritas legítimas de linhas passam pelo repositório transacional, que já recalcula o fechamento. Isso elimina a multiplicação `linhas alteradas × leitura de todas as linhas` e os fechamentos derivados que ela provocava.

Permanece o gatilho por documento de fechamento como reforço eventual, além da atualização síncrona feita pela API. Cada atualização consulta os fechamentos filtrados por workspace, unidade, ano e mês, com limite explícito de `dias da competência + 1`. Mais de um fechamento diário para a mesma unidade viola o identificador determinístico e interrompe o resumo em vez de truncá-lo. Com `D ≤ 31`, o teto é aproximadamente `2 × (D + 1) = 64` leituras por alteração de fechamento, contando API e reforço.

O reforço diário pagina o mês corrente em lotes de 500, com teto de `dias da competência × 1.000 unidades`, e depois relê cada unidade do mês:

```text
U × D + U × D = 2 × U × D
20 unidades × 31 dias × 2 = 1.240 leituras/dia ≈ 37.200/mês
```

Os números devem ser medidos entre 7 e 30 dias após o rollout. A coleção `kiosks` é paginada em páginas de 100, com teto explícito de 1.000 unidades; não existe leitura de coleção sem limite neste fluxo.

## Permissões

As páginas continuam protegidas por navegação e as APIs validam novamente todas as unidades da sessão.

- `cashClosures.view`: ver fechamentos e sessões.
- `cashClosures.approve`: abrir/encerrar sessão e finalizar operadores.
- `cashClosures.reopen`: reabrir e administrar sessão iniciada por outra pessoa.
- `cashDeposits.view`: consultar malotes e cobranças.
- `cashDeposits.issue`: confirmar denominações, registrar a troca da sessão e emitir cobrança.
- `cashDeposits.adjust`: ajustes e realocações.
- `cashDeposits.cancel`: cancelamento bancário.

Sessões, operadores, locks, políticas e auditorias negam leitura e escrita direta nas regras do Firestore. O script de permissões mantém as novas autoridades como `false` nos perfis restritos; o rollout exige definição explícita dos perfis e unidades autorizados.

A composição física exige simultaneamente `cashDeposits.view` e `cashDeposits.issue`. A pessoa que abriu a sessão é a responsável; somente administrador padrão ou perfil com `cashClosures.reopen` pode assumir uma sessão alheia.

## Preflight de dados

Antes da evolução de 31/08, executar o diagnóstico somente leitura com o workspace explícito:

```bash
npm run preflight:cash-counting-sessions -- --workspace=coala
```

O comando pagina sessões abertas e locks, possui teto padrão de 5.000 documentos por conjunto e não escreve. Ele bloqueia o rollout ao encontrar: mais de uma sessão aberta para a mesma unidade, lock global ausente, lock global pertencente a outra sessão ou leitura truncada. Locks obsoletos e sessões sem os novos contadores aparecem separadamente para decisão explícita. Nenhuma correção ou migração é executada pelo preflight.

As duas migrações varrem por páginas de 200 documentos e interrompem acima de 5.000 documentos por coleção por padrão. A leitura de detecção pode chegar a 5.001 documentos por coleção; um volume maior exige revisão explícita de `--max-docs=N` (teto absoluto de 20.000). A migração de permissões também divide as escritas em lotes de 400.

Executar primeiro sem `--execute`:

```bash
npm run migrate:cash-closure-permissions
npm run migrate:cash-deposit-inter
npm run cash-deposit:period-policy -- \
  --workspace coala \
  --period 2026-08 \
  --policy dre_only \
  --reason "Competência histórica usada somente na DRE" \
  --actor-id IDENTIFICADOR_DO_OPERADOR \
  --actor-name "NOME_DO_OPERADOR"
```

Confirmar os documentos e quantidades apresentados antes de repetir com `--execute`. A política usa identificador determinístico e grava auditoria na mesma transação; uma segunda execução idêntica não escreve novamente.

## Configuração remota

- Confirmar que `INTER_COBRANCA_PAYER_CNPJ=14276603000125` corresponde à Entidade pagadora correta.
- Verificar `CASH_CLOSURE_JOB_SECRET`, `INTER_RECONCILIATION_SECRET`, `CASH_DEPOSIT_RECONCILIATION_SECRET`, credenciais, certificado e webhook do Inter.
- Configurar `CASH_CLOSURE_JOB_URL`, `INTER_RECONCILIATION_URL` e `CASH_DEPOSIT_RECONCILIATION_URL` com os endpoints HTTPS definitivos.
- Revisar índices dos bancos padrão e `coala-financeiro` antes do App Hosting.
- O gatilho removido `cashClosureLineWritten` deve ser excluído durante o deploy de Functions, se existir remotamente.

## Sequência de rollout

1. Reintegrar a mudança sobre a `main` atual e revisar o diff por equivalência de patch.
2. Manter verdes `npm run verify`, `npm run check:rules`, `npm run test:integration`, o build das Functions e `npm run validate:cash-closure` quando houver credenciais de preflight.
3. Reautenticar Firebase e Google Cloud e registrar metadados do estado atual.
4. Executar o preflight de sessões/locks, os dry-runs existentes e revisar permissões.
5. Publicar índices e regras.
6. Executar as migrações e a política de competência autorizadas.
7. Publicar App Hosting.
8. Publicar Functions e configurar os jobs.
9. Cadastrar o webhook definitivo por último.
10. Fazer smoke test sem emitir cobrança bancária real, salvo autorização específica.
11. Validar logs, resumos, locks, reconciliação e custo entre 7 e 30 dias.

As etapas registradas como concluídas em 29/08/2026 se referem ao rollout original. Para a evolução de 31/08/2026, o preflight encontrou zero inconsistências; os dry-runs examinaram 7 perfis e zero depósitos legados, sem alteração necessária, e a política `coala_2026_08 = dre_only` já estava idempotente. A reconciliação periódica continua disponível como fallback enquanto o webhook não for conferido.

Rollback do App Hosting e das Functions deve usar as revisões anteriores registradas no preflight. As migrações são aditivas; a política de competência pode voltar a `standard` pelo mesmo comando, com nova auditoria. Nenhuma cobrança já emitida deve ser apagada ou reescrita durante rollback.
