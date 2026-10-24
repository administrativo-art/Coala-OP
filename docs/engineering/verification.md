# Verificação dirigida por impacto

O [relatório por grupo](flow-verification.md) registra referências e lacunas dos 53 grupos na main. Consulte somente a linha pertinente à tarefa; não carregue toda a matriz de evidências a cada pedido.

Escolha as verificações depois de identificar o fluxo pelo [mapa](system-map.md). A fonte dos comandos é [`package.json`](../../package.json); as exigências gerais permanecem em [`AGENTS.md`](../../AGENTS.md).

## Camadas sem repetição

1. **Durante a mudança:** rode o menor teste que reproduza o comportamento afetado.
2. **Antes do push:** rode os contratos específicos da superfície alterada, o E2E correspondente quando o fluxo crítico realmente depender de integração, e `git diff --check`.
3. **No PR:** o único gate `quality` executa uma vez a verificação integral, as regras do Firestore e o build das Functions. Esse resultado no SHA do PR substitui uma segunda execução completa local.

Não rode `npm run check` e depois `npm run verify`: `verify` já inclui `check`. Não repita localmente uma suíte verde no mesmo estado. Se o CI falhar, reproduza somente o comando falho, corrija, valide o subconjunto afetado e deixe o CI repetir o conjunto integral no novo SHA.

Os E2E gerais de observação não rodam em todo PR. O workflow `E2E observation` reúne a preparação de Node, Java, dependências e Chromium uma única vez e executa a varredura semanalmente ou por acionamento manual. Uma alteração em fluxo crítico continua obrigada a rodar o E2E dirigido daquele fluxo antes do push.

Quando páginas do dashboard forem criadas, removidas ou movidas, execute `python3 scripts/generate-route-inventory.py` e confira a alteração em [inventário de rotas](route-inventory.md). Use `python3 scripts/generate-route-inventory.py --check` para detectar inventário desatualizado sem escrever arquivos.
Para página fora do dashboard ou rota de API, execute `python3 scripts/generate-surface-inventory.py` e confira a alteração no [inventário de superfícies](surface-inventory.md). Use `--check` no CI; o inventário apenas detecta caminho/métodos e exige revisão manual dos guias de fluxo.
Atualize também a [matriz página → fluxo](flow-matrix.csv), regenere [entradas por fluxo](flow-entrypoints.md) com `python3 scripts/generate-flow-entrypoints.py` e execute `python3 scripts/check-flow-matrix.py`, `python3 scripts/generate-flow-entrypoints.py --check` e `python3 scripts/check-engineering-docs.py`; o CI verifica esses índices e links locais.

Quando comportamento, dados, permissões ou integrações mudarem, confira também o [critério de manutenção do mapa](system-map-execution.md) e atualize as referências do fluxo no mesmo trabalho. O `--check` não verifica a correção semântica dos guias.

| Alteração | Primeiro teste pertinente local | Gate final no PR |
| --- | --- | --- |
| Sugestão ou filtragem de recibos de férias | `node --import tsx --test tests/unit/dp-vacation-receipt-selection.test.ts` | `npm run check` |
| Transição completa de férias | `node --import tsx --test tests/unit/dp-vacation-workflow.test.ts tests/unit/dp-vacation-end-to-end-workflow.test.ts` | `npm run check`; E2E aplicável para mudança em fluxo crítico |
| Rota, importação ou fronteira server/client | Teste do fluxo afetado | `npm run verify` |
| Contrato ou arquivo de rota de API | Teste legítimo e indevido do fluxo; testes do contrato quando a infraestrutura mudar | `npm run check:security-contracts`; `npm run verify` |
| Regra de acesso Firestore | Teste de regra afetado | `quality` executa `npm run check:rules` |
| Somente documentação de navegação | Verificar todos os links relativos e conferir fontes citadas | `npm run check` conforme `AGENTS.md`, se ambiente de dependências estiver disponível |

Este arquivo aponta **onde verificar**, não afirma cobertura nem sucesso. Registre no relatório da tarefa os comandos realmente executados, resultados e lacunas.

Para mudanças em API, página externa ou export de Functions, revise [surface-flow-matrix.csv](surface-flow-matrix.csv). O gerador de superfícies exige classificação exata das fontes e existência dos guias; o mesmo comando `--check` já executado no CI cobre essa exigência. A [auditoria ampliada](surface-audit.md) distingue associação de entrada, revisão estática de fronteiras e testes de comportamento.


Resultados de E2E e configuração de emuladores do worktree de correções não foram incorporados nesta entrega. Conferir o setup vigente antes de executar testes autorizados.
