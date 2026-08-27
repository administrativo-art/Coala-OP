# Evidência histórica — Google Cloud Logging e Error Reporting

## Proveniência

Este documento preserva as conclusões da auditoria somente leitura realizada em 26/08/2026 na linha anterior de engenharia e localizada no commit `515534f0`. Nenhuma configuração remota foi alterada naquela auditoria, e esta reintegração não repetiu consultas de conteúdo de logs nem modificou Google Cloud.

## Conclusão reaproveitada

Cloud Logging e Google Error Reporting são suficientes como central inicial:

- App Hosting/Cloud Run e Functions já encaminham stdout/stderr;
- Error Reporting já possuía grupos de erros do App Hosting e Functions;
- não havia evidência técnica para Sentry;
- não havia necessidade demonstrada de SDK do Google apenas para emissão de logs;
- a sanitização deve acontecer antes da ingestão;
- o fingerprint do Coala é identidade interna e não controla grouping nativo.

A amostra histórica registrou aproximadamente 0,223 GiB ingeridos no mês e projeção simples de 0,27 GiB/mês. É evidência temporal, não garantia de custo futuro.

## Decisão desta fase

A reintegração mantém `StructuredConsoleSink` sobre stdout/stderr e os campos estruturados aceitos pelo ambiente Google. Não cria alertas, canais, sinks remotos, IAM, retenção, secrets ou dependência de provedor.

A compatibilidade estrutural é prova local. Captura e agrupamento do novo `SystemErrorEvent` no ambiente real permanecem pendentes de rollout e smoke test autorizados.
