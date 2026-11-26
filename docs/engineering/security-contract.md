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

## Revisão local das rotas migradas (26/11/2026)

Correções ainda sem publicação: falhas reconhecidas de token/sessão viram 401; bloqueios de acesso viram 403; falhas de infraestrutura permanecem 500 reportáveis, com causa preservada. A criação de pagamento expõe somente regras marcadas e revisadas, incluindo salário, favorecido, boleto e consultoria; erros técnicos não são classificados por texto genérico. Bootstrap rejeita parâmetros e coleções desconhecidos.

O GET público de admissão preserva a auditoria existente PUBLIC_LINK_ACCESSED (leitura de negócio, auditoria server-authoritative), e o POST registra PUBLIC_FORM_SUBMITTED. Uma falha de extração/snapshot passa por um único limite de erro com cause; não se reporta antes de relançar. A leitura falha se a auditoria de acesso não puder ser persistida.

Erros marcados do kit/proveniência têm mensagem controlada e podem ser reportáveis para reconciliação; isso não promete mensagem de provedor ou status 400 para toda falha. Entradas controladas do provedor são 400, arquivo ausente é 404 reportável, resultado externo incerto é 503 sem retry automático, e falha inesperada é 500 com texto fixo. Envio/adição de signatário exige consultar o acompanhamento antes de repetir. Dados brutos da resposta da Autentique não são usados na mensagem.

Os três métodos do workflow contábil entram no contrato ao corrigir o P1: permissões existentes accountant.view/manage, sem afirmar escopo de unidade inexistente. Auditoria de cada ação continua explicitamente parcial (contrato audit none), e validações de JSON/multipart permanecem nas ações. A migração estrutural não resolve P2/P3/P4 da revisão por si só.

Complemento da revisão independente: o protocolo, encerramento do link, submissão e auditoria autoritativa são atômicos; no CLT, o histórico de consentimento integra essa transação. A projeção para conta existente acontece depois e não substitui a evidência da submissão. As mensagens legadas de acesso usam correspondência exata, nunca prefixo com diagnóstico arbitrário. URLs são conferidas na string original antes de normalização.

Criação de assinatura tem claim transacional persistente. Resultado perdido/erro posterior vira send_unconfirmed e não libera criação após prazo, troca de status, geração ou novo posicionamento. Sem ID do provedor, a reconciliação informa pendência manual, sem recriar. Adição da empresa também fica bloqueada enquanto o provedor não comprovar o signatário; leituras posteriores que o confirmem reconciliam sem outra mutação. Reconciliação consulta até 31 IDs conhecidos adicionais (pacote e 30 componentes), sob demanda, sem varredura ou polling novo.

Na preparação concorrente, cada composição usa diretório UUID exclusivo e gravação com ifGenerationMatch=0; a transação seleciona o par exato de PDF/manifesto. O claim de envio compara a revisão updateTime lida para preparar as posições. A reconciliação também lê as solicitações canônicas, valida origem/titular congelados e repara vínculos de componentes quando o ID confirmado sobreviveu à falha de projeção, sem outra criação no provedor. A verificação transacional adicional de componentes é limitada aos IDs conhecidos (máximo30), sem consulta global recorrente.

O arquivamento compartilhado de assinatura avulsa, inclusive pelo webhook, valida remoção/descarte, fonte histórica e vínculos antes do download e novamente após ele. A atualização final da projeção precede o estado terminal da solicitação e a publicação; se for rejeitada, essas etapas não executam. As transações de projeção e Acervo ficam em bancos distintos e não constituem uma transação distribuída.

Se a publicação de avulso falhar após arquivar, o retorno existente revalida fonte, descarte e vínculos e retoma somente a publicação idempotente, sem outro download/criação nem reversão de retirada manual.
