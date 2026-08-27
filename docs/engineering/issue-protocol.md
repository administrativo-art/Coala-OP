# Protocolo de tratamento de issues

Este protocolo transforma uma falha observada em um contrato verificável. O exemplo reportado é evidência de uma classe de problema; fazê-lo voltar a funcionar, isoladamente, não encerra a issue.

## Fluxo obrigatório

Em todos os registros, identifique explicitamente **FATO**, **INFERÊNCIA**, **HIPÓTESE** e **DECISÃO**. Data, ambiente, origem e responsável devem permanecer rastreáveis sem copiar dados pessoais ou segredos.

### 1. Falha observada

Registre o resultado visível, o ator, a superfície e o momento em que ocorreu. Não antecipe causa.

### 2. Evidência e reprodução

Preserve logs seguros, resposta HTTP, estado relevante, teste que reproduz o comportamento ou passos determinísticos. Identifique claramente quando a reprodução não for tecnicamente viável.

### 3. Classe da falha

Classifique como ocorrência isolada, regra de negócio, contrato entre componentes, integração, regressão, arquitetura ou ambiente/produção. Uma issue pode ter uma classe primária e efeitos secundários.

### 4. Causa confirmada ou hipótese

Separe fatos observados de inferências. Uma hipótese só vira causa confirmada quando uma evidência discrimina explicações concorrentes.

### 5. Contrato ou invariante esperado

Declare a regra que deve continuar verdadeira após a correção. Prefira formulação observável e independente da implementação atual.

### 6. Superfícies afetadas

Liste domínio, API, persistência, interface, autorização, integrações, jobs, documentos e observabilidade que compartilham o contrato.

### 7. Escopo

Defina o menor conjunto de mudanças que elimina a classe da falha.

### 8. Não escopo

Registre refatorações, migrações ou comportamentos adjacentes deliberadamente preservados.

### 9. Risco de recorrência

Explique como outra implementação poderia reintroduzir a falha e qual fronteira precisa de proteção permanente.

### 10. Menor correção sistêmica

Corrija no menor nível compartilhado que garanta o contrato: schema, tipo, regra central, transação, idempotência, autorização no servidor, cliente de transporte ou outra fronteira adequada. Evite abstrações sem consumidor real.

### 11. Teste de regressão

Crie ou amplie um teste que falhe sem a correção e descreva o comportamento que deve permanecer garantido.

> Teste de caracterização descreve o comportamento atual. Teste de regressão descreve o comportamento que deve permanecer garantido após a correção. Não altere silenciosamente um teste de caracterização para fazê-lo concordar com a implementação desejada.

### 12. Verificação completa

Execute os comandos aplicáveis definidos em `AGENTS.md`. Registre comando, exit code, quantidade de testes quando informada e limitações do ambiente.

### 13. Rollout

Defina estratégia, compatibilidade, migração, feature flag, rollback e autorização. Preparar rollout não autoriza deploy.

### 14. Smoke test

Defina uma validação operacional mínima e segura. Não use produção, dados reais ou domínio real sem autorização expressa.

### 15. Critério de conclusão

A issue termina quando o contrato está restaurado, existe proteção permanente, as verificações aplicáveis passaram e pendências externas estão explícitas.

Para bugs acionáveis, registre também impacto, severidade, release da correção, janela de observação e eventual recorrência. Recorrência pós-fix só pode ser afirmada quando o mesmo fingerprint reaparece em uma release posterior; sem essa evidência, mantenha o caso como hipótese ou necessidade de investigação.

## Template reutilizável

```markdown
# [Título orientado ao contrato]

## Identificação
- Data:
- Ambiente:
- Origem:
- Responsável:
- Status:

## Falha observada

## Evidência e reprodução
- Ambiente:
- Passos:
- Resultado atual:
- Evidências:

## Classe da falha

## Impacto e severidade
- Impacto:
- Severidade: low | medium | high | critical

## Causa confirmada ou hipótese
- Evidência:
- Inferência:
- Decisão:

## Contrato ou invariante esperado

## Superfícies afetadas

## Escopo

## Não escopo

## Risco de recorrência

## Menor correção sistêmica

## Teste de regressão

## Justificativa quando não há teste automatizado

## Verificação completa
| Comando | Resultado | Evidência |
|---|---|---|

## Rollout

## Smoke test

## Release

## Janela de observação

## Recorrência

## Links relacionados

## Definição de pronto
- [ ] Contrato restaurado
- [ ] Proteção permanente criada
- [ ] Verificações aplicáveis executadas
- [ ] Rollout e smoke test explicitamente autorizados ou registrados como pendentes
- [ ] Release e janela de observação identificadas quando aplicáveis
- [ ] Recorrência classificada somente com evidência pós-release
```
