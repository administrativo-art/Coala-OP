# Política inicial de triagem e SLA de erros

## Vigência experimental

Política aprovada para avaliação por 30 dias a partir de 26/08/2026. Ela deve ser revisada ao final do período com volume, falsos positivos, tempo de reconhecimento, custo e capacidade operacional observados.

A janela de cobertura e as pessoas nominais precisam ser definidas antes da ativação de alertas de paging. Até isso ocorrer, esta política orienta classificação e preparação de backlog, mas não representa cobertura humana 24x7.

## Modelo operacional

A IA executa a primeira triagem:

- sanitiza e normaliza eventos;
- agrupa pelo fingerprint interno do Coala;
- calcula ocorrência, first seen, last seen e releases;
- elimina duplicidade e ruído conhecido;
- classifica severidade, recorrência e domínio;
- procura issue equivalente;
- prepara rascunho local quando o grupo é acionável.

Uma ocorrência não cria uma issue diretamente. O fluxo obrigatório é evento → fingerprint → grupo → triagem → issue acionável.

## Tempos aprovados

| Severidade | Triagem e reconhecimento | Decisão inicial | Observação |
|---|---|---|---|
| `CRITICAL` | alerta imediato; reconhecimento humano em até 15 minutos dentro da janela de cobertura | contenção inicial em até 1 hora | paging depende de janela e responsáveis definidos |
| `HIGH` | reconhecimento em até 1 hora útil | decisão de mitigação no mesmo dia útil | interrompe o responsável humano |
| `MEDIUM` | triagem no próximo dia útil | prioridade e plano definidos em até 5 dias úteis | não exige interrupção imediata |
| `LOW` | triagem automática | revisão semanal | normalmente segue para backlog agrupado |

Os prazos acima são de triagem, reconhecimento ou decisão. Eles não são prazos obrigatórios de resolução definitiva.

## Interrupção humana

Priorizar comunicação humana para:

- `HIGH` e `CRITICAL`;
- classificação relevante `AMBIGUOUS`;
- `REGRESSION`;
- `SECURITY_INCIDENT`;
- `FINANCIAL_INCIDENT`;
- `DATA_INTEGRITY`.

Grupos `LOW`/`MEDIUM` conhecidos, duplicidades, ruído e falhas esperadas seguem o fluxo automatizado, salvo mudança comprovada de impacto.

## Responsabilidade pendente

Antes de ativar paging, registrar:

- horário e dias da janela de cobertura;
- função responsável primária;
- pessoas ou canal nominal;
- fallback;
- regra para feriados e indisponibilidade;
- forma de reconhecimento do alerta.

Nenhum canal de paging foi ativado nesta etapa.
