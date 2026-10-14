# Relatório, priorização e reteste

## Relatório inicial

O `report.md` deve conter:

1. resumo executivo sem alegação de segurança absoluta;
2. revisão/branch, escopo autorizado, ambiente e ferramentas;
3. inventário e cobertura por estado;
4. controles validados nos cenários testados;
5. achados ordenados por risco e exposição;
6. hipóteses e testes pendentes;
7. limitações e superfícies não revisadas;
8. plano de correção priorizado, sem implementação automática.

Cada achado inclui ID, título, severidade, estado, localização, descrição, causa raiz conhecida ou hipótese, ativo, pré-condições, impacto, evidência sanitizada, reprodução segura, referências verificadas, correção recomendada e teste de regressão.

Use severidades `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` e `INFORMATIONAL`. CVSS exige versão, vetor, pontuação e justificativa; omita a pontuação se não houver base suficiente.

## Aceite e exceções

Risco aceito precisa de responsável, justificativa, controles compensatórios, prazo e expiração. Baseline ou alerta silenciado não é aceitação implícita.

## Reteste

Reteste somente achados selecionados. Preserve a evidência original, registre revisão da correção, repita o cenário indevido e o legítimo e execute regressões pertinentes. Use: `FIXED_VALIDATED`, `PARTIALLY_FIXED`, `NOT_FIXED`, `INCONCLUSIVE` ou `NOT_RUN`.

Alteração de código sem execução do teste não muda o achado para corrigido. Se o reteste revelar outra classe de falha, crie novo achado em vez de reescrever a história do original.
