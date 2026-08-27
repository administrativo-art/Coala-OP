# Política inicial de triagem de erros

## Estado

A política é experimental e local. Não há alertas, notification channels, paging ou automação externa configurados nesta fase.

O fluxo é:

```text
evento → fingerprint → grupo → triagem → rascunho de issue → revisão humana
```

Uma ocorrência não publica issue automaticamente.

## Prioridade

- `CRITICAL`: segurança, integridade de dados ou financeiro; destacar para revisão humana imediata.
- `HIGH`: falha terminal de função importante ou integração; priorizar caracterização e issue.
- `MEDIUM`: impacto moderado ou transitório; agrupar e avaliar crescimento/terminalidade.
- `LOW`: esperado ou recuperável; não interromper o fluxo normal sem padrão anormal.
- `AMBIGUOUS`: evidência incompleta; investigar sem inventar causa.

Essas prioridades orientam triagem e reconhecimento, não constituem prazo garantido de resolução.

## Evidência mínima

Recorrência ou regressão exige evento posterior à correção. `REGRESSION` exige também release diferente da release corrigida. Sem `fixedAt`/`closedAt` e `fixedRelease`, a skill mantém a incerteza explícita.

Ausência de evento em um export não prova resolução, ausência no ambiente nem volume total. O fingerprint interno agrupa evidências; correlação não confirma causalidade.
