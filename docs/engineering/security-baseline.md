# Security baseline — Fase A

Esta fase separa detecção de remediação. Encontrar uma vulnerabilidade, um segredo histórico ou um alerta de análise estática não autoriza alteração de dependência, runtime, credencial ou aplicação.

## Controles

- GitHub Secret Scanning e Push Protection para o repositório público;
- Dependabot Alerts, sem Security Updates e sem Version Updates;
- Private Vulnerability Reporting e `SECURITY.md`;
- CodeQL para JavaScript/TypeScript em pull requests, push para `main` e agenda semanal;
- referências de GitHub Actions fixadas por SHA integral de release oficial;
- ratchet de `npm audit` separado entre raiz e `functions`;
- ratchet de contrato de segurança para toda rota de API nova ou alterada;
- `coala-security-audit` e `coala-security-supply-chain` locais e explicit-only.

O CodeQL é report-only nesta fase: seus achados aparecem em code scanning, mas o job não é um required check. Erro de execução do scanner continua sendo falha do workflow.

## Ratchet de vulnerabilidades

Os arquivos `config/vulnerability-baseline.root.json` e `config/vulnerability-baseline.functions.json` registram a dívida observada na última remediação explícita, em 2026-10-12. Eles são evidência versionada, não uma lista de riscos aceitos e não são atualizados pelo comando de verificação.

`npm run check:vulnerabilities` consulta `npm audit`, normaliza advisories e pacotes vulneráveis e bloqueia:

- advisory novo `high` ou `critical`;
- pacote vulnerável novo `high` ou `critical`;
- qualquer dependência direta nova já vulnerável;
- aumento de severidade de advisory ou pacote;
- dependência vulnerável que passe a ser direta.

Novos achados `low` ou `moderate` transitivos e alterações não relacionadas à severidade são informados para triagem sem esconder a dívida. Vulnerabilidades removidas aparecem como melhoria e não reescrevem o baseline automaticamente; uma remediação autorizada pode reduzir o snapshot versionado depois da validação.

Remediação de 2026-10-12: uma instalação limpa atualizou `firebase-admin` para 14.5, `firebase-functions` para 7.4, Firebase CLI para 15.33 e transitivas compatíveis. O pacote `functions` removeu `firebase-functions-test`, que não possuía consumidores no repositório e prendia um grafo Jest vulnerável; `npm audit` passou a reportar zero achados totais nesse pacote.

A continuação da remediação migrou Tailwind CSS 3 para 4, substituiu o runtime Genkit pelo SDK oficial `@google/genai` e atualizou `google-auth-library` para a série 10. A raiz caiu de 72 achados (58 moderados e 14 altos) para 11 (4 moderados e 7 altos), todos restritos às ferramentas de desenvolvimento `eslint-config-next` e `firebase-tools`, já nas versões mais recentes verificadas. A auditoria com `--omit=dev` e a auditoria independente de `functions` ficaram ambas em zero. Os snapshots foram reduzidos para esse estado e as exceções temporárias foram encerradas.

Exceções ficam em `config/vulnerability-exceptions.json`. Cada exceção deve identificar exatamente o `findingKey`, ter justificativa e data de expiração. Exceção expirada, duplicada ou incompleta invalida a execução. Alterar baseline ou exceção exige revisão humana explícita; o CI nunca os regenera.

Em 2026-10-23, uma publicação emergencial autorizada adicionou exceções com expiração em 2026-10-30 para os novos advisories de `body-parser` e `zod`, publicados após o baseline e não introduzidos pela mudança funcional. A remediação definitiva deve atualizar as dependências transitivas e migrar o Zod em trabalho dedicado antes da expiração; o baseline não foi ampliado.

Uma falha de rede ou resposta inválida do registry é falha operacional distinta, não aprovação silenciosa.

## Ratchet de contratos de API

O [contrato executável de segurança](security-contract.md) separa garantias mínimas da estratégia que as implementa. Rotas novas ou arquivos de rota alterados precisam usar `secureRoute` em cada método exportado ou possuir exceção temporária delimitada. O arquivo `config/security-contract-baseline.json` guarda o hash da dívida legada observada na implantação inicial: igualdade de hash permite evolução incremental, mas não aprova a segurança da rota. O CI executa `npm run check:security-contracts` em modo somente leitura e também confere o [inventário](security-contract-inventory.md).

## Tratamento de achados

Achados são deduplicados por advisory/componente, classificados e encaminhados para a Fase B. Esta fase não executa `npm audit fix`, não atualiza dependências, não modifica código para satisfazer CodeQL e não remove ou rotaciona credenciais.

## Custo e limites

Os controles desta fase usam recursos gratuitos para repositório público e runners padrão do GitHub. Nenhum runner adicional, GitHub Advanced Security pago, scanner SaaS ou API faturável foi adicionado. O custo operacional inclui maior duração de CI, triagem humana e possíveis falsos positivos.

As Actions existentes permanecem em suas versões major atuais, fixadas nas releases oficiais `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0 e `actions/setup-java` v4.9.1. O CodeQL usa `github/codeql-action` v4.37.9. O comentário ao lado de cada SHA conserva a versão humana; atualização futura exige revisão explícita.
