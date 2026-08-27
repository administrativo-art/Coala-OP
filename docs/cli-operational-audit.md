# Auditoria operacional de CLIs

## Objetivo

Registrar no próprio Coala as sessões iniciadas por ferramentas de linha de comando e as operações relevantes executadas nelas, sem conservar scripts temporários como substituto de histórico.

## O que é registrado

- ferramenta utilizada;
- início, término, duração e código de saída da sessão;
- repositório, branch, commit e indicação de alterações locais;
- ator local ou identidade informada por `COALA_AUDIT_USER_ID` e `COALA_AUDIT_USERNAME`;
- operações declaradas, destino, valor, situação e resumo sanitizado;
- retenção padrão de 365 dias.

Prompts, argumentos completos, variáveis de ambiente, tokens, chaves Pix, linhas digitáveis e segredos não são registrados.

## Regra em três camadas

1. O hook do shell registra automaticamente início e fim de Codex, Claude, Gemini, Aider, OpenCode e Cursor Agent quando iniciados dentro do repositório.
2. Toda rotina operacional deve registrar seus eventos usando `COALA_OPERATION_SESSION_ID` antes e depois de alterar dados.
3. A garantia definitiva exige que gravações administrativas diretas sejam bloqueadas por IAM e que as mutações passem por APIs autenticadas do Coala, que gravam `actionLogs` no mesmo fluxo.

A primeira camada identifica a sessão, mas não consegue provar sozinha todas as alterações feitas por um processo com credencial administrativa. A terceira camada é a fronteira que torna a auditoria obrigatória independentemente da ferramenta usada.

## Adicionar outra CLI

Configure os nomes adicionais, separados por dois-pontos:

```zsh
export COALA_AUDITED_CLIS="minha-cli:outra-cli"
```

## Registrar uma operação

Uma rotina iniciada dentro de uma sessão auditada recebe `COALA_OPERATION_SESSION_ID`. Para registrar um evento:

```zsh
node --env-file=.env.local scripts/cli-session-audit.mjs event \
  --session-id="$COALA_OPERATION_SESSION_ID" \
  --operation="expense_registered" \
  --status="completed" \
  --target-type="expense" \
  --target-id="ID_DA_DESPESA" \
  --target-name="Compra do fornecedor" \
  --amount="100.00" \
  --summary="Despesa registrada e validada"
```

## Onde aparece

Os eventos são gravados em `actionLogs`, módulo `system.cli`, e aparecem em Configurações > Privacidade > Auditoria interna. As sessões estruturadas ficam em `cliOperationSessions`, com os eventos detalhados na subcoleção `events`.
