# Retenção e busca da caixa financeira

## Política operacional

- Mensagens `ignored` ou `reconciled` permanecem na caixa ativa por seis meses após a última atualização do tratamento.
- Depois desse prazo, o job altera o status para `archived`, preserva o status anterior e registra um evento de auditoria.
- O arquivamento não exclui a despesa, o pagamento, o comprovante, os anexos nem o e-mail original.
- Uma mensagem arquivada pode ser restaurada pela aba **Arquivadas**. A restauração recupera `ignored` ou `reconciled` e reinicia o prazo operacional.
- `purgeEligibleAt` é apenas a data mínima para uma futura política de minimização: 1 ano para conteúdo não financeiro, 6 anos para o financeiro comum e 10 anos para tributos ou folha. Não há expurgo definitivo automático nesta versão.

## Busca indexada

Cada mensagem possui `searchTerms` e `searchIndexVersion`. O índice cobre fornecedor, remetente, assunto, valor, competência, vencimento, CNPJ, conta, contrato e telefone. Enquanto o backfill ou o índice composto não estiver pronto, a API usa a busca limitada anterior como fallback.

## Automação

A função `financialInboxMaintenance` roda diariamente às 02:20 em `America/Belem` e chama:

```text
POST /api/jobs/financial-inbox/maintenance
```

O endpoint usa `INTER_RECONCILIATION_SECRET`, aceita no máximo 400 registros por lote e opera em `dry-run` quando o modo não é informado. O agendamento envia explicitamente `mode: execute` e processa 300 índices e até 200 arquivamentos por execução.

## Custo e limites

- Backfill atual: 46 mensagens, portanto até 46 leituras, 46 atualizações e uma escrita de estado para concluir a primeira indexação.
- Manutenção diária sem itens elegíveis: uma leitura do estado e a leitura mínima da consulta de retenção, aproximadamente 60 leituras por mês.
- Execução diária no teto de 200 arquivamentos: até 400 leituras e 400 escritas na execução, porque cada candidato é relido na transação e gera a atualização da mensagem e um evento de auditoria.
- Busca: é acionada somente na página, possui debounce de 350 ms, usa `workspaceId`, status e termo indexado, e examina no máximo 500 candidatos por solicitação. No cenário conservador de 2 buscas/hora × 5 usuários × 8 horas/dia × 22 dias, o teto é 880.000 leituras de candidatos por mês; termos seletivos retornam substancialmente menos documentos.
- Não existe polling, listener global nem leitura sem limite. O job roda uma vez por dia e todos os lotes possuem limite e cursor/estado persistido.

## Permissões

A listagem e a busca continuam exigindo `financial.inbox.view`. A restauração de um item arquivado reutiliza `financial.inbox.discard`, validada no servidor, porque ela desfaz a mesma decisão operacional sem alterar despesa, pagamento ou conciliação. Perfis existentes não precisam de migração e nenhuma autorização bancária foi ampliada.

## Rollout

1. Executar `npm run preflight:financial-inbox -- --max-docs=5000`.
2. Publicar `firestore.financial.indexes.json` e aguardar o índice ficar pronto.
3. Publicar a aplicação.
4. Publicar a função `financialInboxMaintenance`.
5. Conferir o primeiro resultado e a aba **Arquivadas**.

O preflight é somente leitura e interrompe se o limite não cobrir toda a coleção.
