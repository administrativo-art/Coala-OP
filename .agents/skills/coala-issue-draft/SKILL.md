---
name: coala-issue-draft
description: Cria um rascunho local e sanitizado de issue do Coala-OP a partir de relato, print ou log. Use somente quando o usuário invocar explicitamente esta skill; nunca publique a issue nem altere código.
disable-model-invocation: true
user-invocable: true
---

# Coala issue draft

Crie somente um rascunho Markdown local. Não publique, não corrija código, não crie branch e não execute commit ou push.

## Entrada

Use o texto da conversa, anexos disponíveis, logs colados, caminhos indicados e informações de ambiente fornecidas. Não dependa de `$ARGUMENTS`. Leia somente os arquivos necessários e não abra `.env` nem credenciais.

## Fluxo

1. Leia `AGENTS.md` e, quando relevante, `docs/engineering/issue-protocol.md`.
2. Colete branch e commit com comandos Git somente leitura.
3. Separe fatos, inferências e hipóteses. Um print comprova o resultado visual, não a causa.
4. Remova ou anonimize tokens, e-mails, telefones, CPF, dados bancários, nomes pessoais e identificadores desnecessários.
5. Calcule um caminho sem colisão com `node .agents/skills/coala-issue-draft/scripts/create-output-path.mjs <slug>`. A saída deve permanecer em `.ai-work/issues/`.
6. Escreva o rascunho com todos os títulos abaixo. Use `NÃO INFORMADO` e mantenha pendências explícitas quando faltar evidência.
7. Execute `node .agents/skills/coala-issue-draft/scripts/validate-issue.mjs <arquivo>` e `node .agents/skills/coala-issue-draft/scripts/scan-sensitive-content.mjs <arquivo>`.
8. Conclua informando o caminho criado e o resultado real dos dois validadores.

## Estrutura obrigatória

```markdown
# <Título objetivo>

## Status do rascunho
PRONTO PARA REVISÃO | INCOMPLETO

## Origem
## Ambiente
## Falha observada
## Evidências
## Passos de reprodução
## Comportamento esperado
## Comportamento ocorrido
## Impacto
## Classe da falha
## Contrato ou invariante possivelmente violado
## Superfícies potencialmente afetadas
## Escopo
## Não escopo
## Causa confirmada
## Hipóteses ainda não verificadas
## Teste de regressão esperado
## Validação pós-implantação
## Dados removidos ou anonimizados
## Pendências para completar a issue
```

Em `Ambiente`, inclua Branch, Commit, Ambiente, Navegador/dispositivo e Data aproximada. A classe deve ser uma das previstas no protocolo ou `ainda não determinada`.

## Limites

- Não execute comandos de publicação, GitHub write, commit, push, deploy ou rollout.
- Não atribua causa, impacto, versão, browser, rota ou erro sem evidência.
- Não copie payload pessoal ou log integral quando um resumo seguro for suficiente.
- Não escreva fora do arquivo de rascunho escolhido em `.ai-work/issues/`.
