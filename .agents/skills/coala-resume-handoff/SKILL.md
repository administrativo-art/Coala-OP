---
name: coala-resume-handoff
description: Valida um handoff do Coala-OP contra o checkout atual antes de qualquer continuação. Use somente por invocação explícita; sem autorização inequívoca, opere em modo VALIDATE e não altere código.
disable-model-invocation: true
user-invocable: true
---

# Coala resume handoff

Valide se o checkout atual continua compatível com um handoff. O handoff é evidência histórica, não fonte absoluta.

## Modos

- `VALIDATE`: modo padrão. Compara handoff e checkout sem modificar código.
- `CONTINUE`: somente quando o usuário instruir inequivocamente a continuar. Ainda assim, valide primeiro e execute apenas o próximo passo exato autorizado.

## Entrada

Receba um caminho de handoff dentro do repositório, normalmente `.ai-work/handoffs/<arquivo>.md`. Rejeite arquivo inexistente, path traversal, contrato inválido e symlink que resolva fora do workspace.

## Validação obrigatória

1. Leia `AGENTS.md`.
2. Execute `node .agents/skills/coala-resume-handoff/scripts/compare-handoff-state.mjs <handoff>`.
3. Informe uma classificação exatamente como produzida pelo script:
   - `COMPATÍVEL`;
   - `DIVERGÊNCIA NÃO BLOQUEANTE`;
   - `DIVERGÊNCIA BLOQUEANTE`;
   - `HANDOFF INVÁLIDO`.
4. Explique as divergências sem executar checkout, reset, merge, rebase ou descarte de alterações.

## Continuação autorizada

No modo `CONTINUE`, prossiga somente se não houver divergência bloqueante:

1. preserve toda alteração posterior;
2. recalcule o plano pelo checkout atual;
3. execute apenas `Próximo passo exato` do handoff dentro da autorização atual;
4. rode as verificações aplicáveis;
5. crie novo handoff somente se solicitado.

Não interprete “leia”, “valide”, “revise” ou a mera seleção da skill como autorização para editar.

## Limites

- Não faça checkout, reset, merge, rebase, stash, commit, push, deploy ou rollout automaticamente.
- Não ignore branch diferente, commit não ancestral, arquivo citado removido ou contrato inválido.
- Não escreva durante `VALIDATE`.
- Não continue múltiplas pendências; limite-se ao próximo passo exato autorizado.
