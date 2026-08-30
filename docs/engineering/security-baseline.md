# Security baseline — Fase A

Esta fase separa detecção de remediação. Encontrar uma vulnerabilidade, um segredo histórico ou um alerta de análise estática não autoriza alteração de dependência, runtime, credencial ou aplicação.

## Controles

- GitHub Secret Scanning e Push Protection para o repositório público;
- Dependabot Alerts, sem Security Updates e sem Version Updates;
- Private Vulnerability Reporting e `SECURITY.md`;
- CodeQL para JavaScript/TypeScript em pull requests, push para `main` e agenda semanal;
- referências de GitHub Actions fixadas por SHA integral de release oficial;
- ratchet de `npm audit` separado entre raiz e `functions`;
- `coala-supply-chain-audit` local e explicit-only.

O CodeQL é report-only nesta fase: seus achados aparecem em code scanning, mas o job não é um required check. Erro de execução do scanner continua sendo falha do workflow.

## Ratchet de vulnerabilidades

Os arquivos `config/vulnerability-baseline.root.json` e `config/vulnerability-baseline.functions.json` registram a dívida observada em 2026-08-28. Eles são evidência versionada, não uma lista de riscos aceitos e não são atualizados pelo comando de verificação.

`npm run check:vulnerabilities` consulta `npm audit`, normaliza advisories e pacotes vulneráveis e bloqueia:

- advisory novo `high` ou `critical`;
- pacote vulnerável novo `high` ou `critical`;
- qualquer dependência direta nova já vulnerável;
- aumento de severidade de advisory ou pacote;
- dependência vulnerável que passe a ser direta.

Novos achados `low` ou `moderate` transitivos e alterações não relacionadas à severidade são informados para triagem sem esconder a dívida. Vulnerabilidades removidas aparecem como melhoria e não reescrevem o baseline.

Exceções ficam em `config/vulnerability-exceptions.json`. Cada exceção deve identificar exatamente o `findingKey`, ter justificativa e data de expiração. Exceção expirada, duplicada ou incompleta invalida a execução. Alterar baseline ou exceção exige revisão humana explícita; o CI nunca os regenera.

Uma falha de rede ou resposta inválida do registry é falha operacional distinta, não aprovação silenciosa.

## Tratamento de achados

Achados são deduplicados por advisory/componente, classificados e encaminhados para a Fase B. Esta fase não executa `npm audit fix`, não atualiza dependências, não modifica código para satisfazer CodeQL e não remove ou rotaciona credenciais.

## Custo e limites

Os controles desta fase usam recursos gratuitos para repositório público e runners padrão do GitHub. Nenhum runner adicional, GitHub Advanced Security pago, scanner SaaS ou API faturável foi adicionado. O custo operacional inclui maior duração de CI, triagem humana e possíveis falsos positivos.

As Actions existentes permanecem em suas versões major atuais, fixadas nas releases oficiais `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0 e `actions/setup-java` v4.9.1. O CodeQL usa `github/codeql-action` v4.37.9. O comentário ao lado de cada SHA conserva a versão humana; atualização futura exige revisão explícita.
