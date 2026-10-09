# Contrato executável de segurança das APIs

Este controle torna obrigatórias as garantias de segurança de rotas novas ou alteradas sem presumir que um algoritmo único seja sempre o melhor. O contrato declara **o que** deve ser garantido; o enforcer implementa **como**. Um enforcer customizado pode acrescentar MFA, política contextual, vínculo criptográfico, rate limit ou outro controle superior, mas não pode omitir as garantias mínimas declaradas.

Esta primeira entrega cria a infraestrutura e congela a dívida existente. Ela não migra rotas legadas, não corrige achados da auditoria e não comprova que uma rota do baseline esteja segura.

## Componentes

- [`route-contract.ts`](../../src/lib/security/route-contract.ts) define o schema versionado, valida combinações incompatíveis e deriva as garantias mínimas.
- [`enforcer.ts`](../../src/lib/security/enforcer.ts) oferece o pipeline padrão e aceita implementações customizadas que satisfaçam o mesmo contrato.
- [`secure-route.server.ts`](../../src/lib/security/secure-route.server.ts) confere contrato, enforcer, método e caminho antes de expor o handler e preserva o envelope central de erros sanitizados.
- [`check-security-contracts.mjs`](../../scripts/check-security-contracts.mjs) aplica o ratchet a todos os arquivos `src/app/api/**/route.*`.
- [`security-contract-baseline.json`](../../config/security-contract-baseline.json) registra por hash a dívida legada intacta.
- [`security-contract-exceptions.json`](../../config/security-contract-exceptions.json) contém apenas exceções temporárias com fonte, métodos, responsável, justificativa e expiração.
- [`security-contract-inventory.md`](security-contract-inventory.md) apresenta o estado de cada arquivo de rota.

## Estrutura

Cada método tem contrato próprio e versionado. A declaração cobre superfície, exposição, identidade, autorização, escopo do recurso, validação de entrada, efeito, auditoria e exposição de erros:

```ts
import { secureRoute } from "@/lib/security/secure-route.server";

const updateRequestContract = defineSecurityContract({
  schemaVersion: 1,
  id: "stock.reposition.update",
  version: 1,
  surface: {
    method: "PATCH",
    path: "/api/stock/reposition-requests/[requestId]",
  },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "stock.reposition.update" },
  resourceScope: { kind: "unit" },
  input: {
    kind: "schema",
    schema: "stock.reposition.update-input",
    unknownFields: "reject",
  },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

export const PATCH = secureRoute(
  { contract: updateRequestContract, enforcer: updateRequestEnforcer },
  async ({ security }) => {
    // O handler recebe ator, entrada e recurso depois das verificações.
    return Response.json({ ok: true });
  },
);
```

O pipeline padrão executa, na ordem: autenticação, parsing/validação da entrada, carregamento do recurso, autorização e escopo. Para uma estratégia diferente, use `defineSecurityEnforcer` e declare as garantias verificáveis. `secureRoute` falha na inicialização se faltar alguma garantia exigida do enforcer. Garantias adicionais nunca são herdadas automaticamente pelo executor padrão.

O wrapper fornece a sanitização central de erros. Auditoria descreve uma obrigação do efeito e não é atribuída automaticamente ao enforcer pré-handler: sua atomicidade e autoria precisam ser comprovadas no teste de persistência da rota. Declarar uma garantia também não demonstra que a implementação está correta. Toda migração precisa de testes que comparem uso legítimo e tentativa indevida, incluindo efeito persistido quando houver escrita. Controles customizados devem acrescentar garantias específicas em `additionalGuarantees` quando elas fizerem parte do compromisso da rota.

## Ratchet incremental

O verificador classifica cada arquivo:

- `CONTRACTED`: todos os métodos HTTP exportados usam diretamente `secureRoute`;
- `LEGACY_BASELINE`: o arquivo não está contratado, mas seu conteúdo normalizado por quebra de linha permanece no hash congelado;
- `EXCEPTION`: todos os métodos ainda não contratados estão cobertos por exceção válida e não expirada;
- `VIOLATION`: rota nova, rota legada alterada, método sem contrato, arquivo sem método reconhecido ou exceção inválida.

Assim, qualquer alteração em arquivo legado exige migrar todos os seus métodos ou obter uma exceção curta e revisável. Mudança apenas cosmética também rompe o hash: essa fricção é intencional para evitar que dívida ativa continue invisível.

O baseline pode diminuir à medida que rotas são migradas. Regenerá-lo para incorporar código novo ou alterado neutralizaria o controle e não é permitido no fluxo normal. A geração existe somente para implantação inicial ou revisão dedicada da própria política; o CI apenas lê os arquivos versionados.

## Exceções

Uma exceção não aceita curingas e deve informar caminho exato, métodos, responsável, motivo concreto e `expiresAt` em `YYYY-MM-DD`. Expiração, duplicidade, rota inexistente ou cobertura parcial falham no check. Exceção é dívida explícita, não certificação da rota.

## Verificação

```bash
npm run check:security-contracts
node --import tsx --test tests/unit/security/route-security-contract.test.ts tests/unit/security/security-contract-ratchet.test.ts
npm run security-contracts:inventory
```

O último comando escreve o inventário e só deve ser usado quando seu conteúdo realmente mudou. `npm run check` executa o verificador em modo somente leitura; `npm run verify` também executa o build.

## Limites

O gate reconhece a forma estrutural `export const METHOD = secureRoute(...)` somente quando `secureRoute` vem do módulo canônico, inclusive com alias de importação; uma função local homônima não satisfaz o contrato. Ele não substitui revisão de código, testes de autorização, DAST, regras do Firestore, configuração de infraestrutura nem reteste. O baseline inicial preserva entrega incremental, mas todas as rotas nele permanecem não validadas por este mecanismo até a migração individual.
