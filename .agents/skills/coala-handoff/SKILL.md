---
name: coala-handoff
description: Registra um handoff factual e local do Coala-OP para continuação em outra sessão. Use somente por invocação explícita; não altere o código da tarefa nem faça commit, push ou deploy.
disable-model-invocation: true
user-invocable: true
---

# Coala handoff

Crie um documento factual para outra sessão continuar a tarefa. Esta skill escreve somente o handoff em `.ai-work/handoffs/` e não modifica o código da tarefa.

## Coleta obrigatória

1. Leia `AGENTS.md`.
2. Execute `node .agents/skills/coala-handoff/scripts/collect-git-state.mjs` e use o JSON como fonte do estado atual.
3. Diferencie alterações preexistentes das feitas na sessão. Quando não houver evidência, marque `INCONCLUSIVO`.
4. Calcule um caminho sem colisão com `node .agents/skills/coala-handoff/scripts/create-output-path.mjs <slug>`. O nome segue `YYYY-MM-DD-HHMM-<slug>.md`.
5. Redija o handoff com o frontmatter e os títulos abaixo.
6. Execute `node .agents/skills/coala-handoff/scripts/validate-handoff.mjs <arquivo>` antes de concluir.

## Frontmatter obrigatório

```yaml
---
handoff_version: "1"
created_at: "<ISO-8601 UTC>"
repository: "Coala-OP"
branch: "<branch>"
base_commit: "<HEAD>"
working_tree_dirty: true
continuation_mode: "validate-first"
status_fingerprint: "<sha256 do status --short>"
---
```

Não grave o caminho absoluto pessoal no documento. O `status_fingerprint` deve vir do coletor.

## Estrutura obrigatória

```markdown
# Handoff — <tarefa>

## Objetivo
## Estado inicial
## Estado atual
## Alterações preexistentes
## Alterações feitas nesta sessão
## Arquivos modificados
## Comandos realmente executados
| Comando | Exit code | Resultado |
## Verificações realmente executadas
## Decisões tomadas
## Fundamentação
## Alternativas rejeitadas
## Fatos confirmados
## Hipóteses não verificadas
## Problemas encontrados
## Bloqueios
## Pendências
## Próximo passo exato
## Critério de conclusão
## Instrução para retomada
## Estado final do Git
```

Em `Arquivos modificados`, use caminhos relativos entre crases. Registre somente comandos realmente executados e seus exit codes reais.

## Limites

- Não declare teste verde sem comando e resultado.
- Não atribua à sessão uma alteração preexistente.
- Não copie diffs extensos, segredos ou dados pessoais.
- Não execute commit, push, publicação, deploy ou rollout.
- Não escreva fora do handoff escolhido em `.ai-work/handoffs/`.
