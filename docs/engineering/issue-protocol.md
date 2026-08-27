# Protocolo de tratamento de issues

Uma issue não está resolvida apenas porque o exemplo reportado voltou a funcionar. Ela está concluída quando o contrato violado voltou a ser garantido por um artefato permanente e as verificações aplicáveis foram executadas.

## Fluxo obrigatório

### 1. Falha observada

Descreva o comportamento percebido, com data, ambiente e impacto. Não inclua uma causa ainda não comprovada.

### 2. Evidência e reprodução

Registre logs sanitizados, entradas mínimas, pré-condições e passos de reprodução. Se não for tecnicamente viável reproduzir, explique por quê e preserve a melhor evidência disponível.

### 3. Classe da falha

Classifique como ocorrência isolada, regra de negócio, contrato entre componentes, integração, regressão, arquitetura ou ambiente/produção.

### 4. Causa confirmada ou hipótese

Separe explicitamente evidência, inferência, hipótese e decisão. Uma hipótese só vira causa confirmada quando houver evidência que a sustente.

### 5. Contrato ou invariante esperado

Declare a regra que deveria permanecer verdadeira, independentemente do exemplo concreto.

### 6. Superfícies afetadas

Liste módulos, APIs, dados, perfis, integrações e ambientes que podem compartilhar a mesma classe de falha.

### 7. Escopo

Defina o que será alterado nesta issue.

### 8. Não escopo

Registre mudanças correlatas que foram deliberadamente excluídas.

### 9. Risco de recorrência

Explique como uma implementação futura poderia reintroduzir a falha e qual proteção precisa existir.

### 10. Menor correção sistêmica

Escolha o menor nível de abstração que elimina a classe do problema sem criar uma arquitetura desnecessária.

### 11. Teste de regressão

Crie ou identifique o teste que falha sem a correção e protege o comportamento esperado.

> Teste de caracterização descreve o comportamento atual. Teste de regressão descreve o comportamento que deve permanecer garantido após a correção. Não altere silenciosamente um teste de caracterização para fazê-lo concordar com a implementação desejada.

### 12. Verificação completa

Execute os comandos aplicáveis e registre comando, exit code e resultado. Diferencie falhas preexistentes de falhas introduzidas pela mudança.

### 13. Rollout

Identifique se a mudança exige deploy, migração, feature flag ou coordenação externa. Rollout é uma ação separada de commit, push e merge.

### 14. Smoke test

Defina uma validação operacional não destrutiva e proporcional ao risco. Um teste local não substitui validação operacional quando ela for necessária.

### 15. Critério de conclusão

Confirme que a correção, a proteção permanente e as verificações estão presentes. Responda: "se amanhã outra implementação tocar neste componente, o que impede a falha de voltar?".

## Template reutilizável

```markdown
# Falha observada

## Evidência e reprodução

## Classe da falha

## Causa confirmada

## Hipóteses ainda abertas

## Contrato ou invariante violado

## Superfícies afetadas

## Escopo

## Não escopo

## Risco de recorrência

## Menor correção sistêmica

## Teste de regressão

## Verificações executadas

| Comando | Exit code | Resultado |
|---|---:|---|

## Rollout

## Smoke test

## Critério de conclusão
```
