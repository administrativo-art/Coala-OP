# Integração: criação do colaborador e primeiro acesso

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Pré-requisitos de contador, assinatura e ASO são etapas anteriores ainda documentadas separadamente.

## Entrada e percurso

A [tela de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) envia `create_collaborator`, `create_first_access_link`, `verify_integrations` e `complete` a [`PATCH /api/hr/onboarding/[id]`](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts), que exige `onboarding.manage`. Para não PJ, a criação exige etapa `integration` e configurações finais salvas; para PJ, exige etapa própria, aprovação financeira e acessos configurados. A rota impede segunda criação se já houver `collaboratorUserId`.

1. [`createCollaboratorFromOnboarding`](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts) obtém ou cria usuário no Firebase Auth, evita reutilizar conta existente de origem incompatível, resolve cargo, função, unidade, turno e perfil padrão e grava `users/{uid}` no banco principal. Grava `employees/{uid}`, valores de campos, privacidade e consentimento no banco RH. Promove documentos aprovados, artefatos admissionais e documentos assinados ao arquivo do colaborador, sincroniza foto e cria link de primeiro acesso. PJ segue `createPjUserFromOnboarding`.
2. A rota registra no processo IDs, promoção documental, status de acesso, link e alertas Bizneo/PDV; depois faz auditoria e tenta enviar e-mail de primeiro acesso usando o snapshot do modelo de integração. `create_first_access_link` só gera novo link para conta criada por esta integração e ainda sem senha cadastrada. [Fonte](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts).
3. [`maybeAdvanceAfterFirstAccess`](../../../src/lib/hr/onboarding-access-provisioning.ts) exige conta criada, e-mail entregue e primeiro acesso usado. Em transação, marca o provisionamento `completed` e a integração `active`. O [webhook de e-mail](../../../src/app/api/webhooks/resend/route.ts) usa essa função após entrega; o uso do link é controlado em [`first-access-links.ts`](../../../src/lib/first-access-links.ts).
4. `verify_integrations` consulta Bizneo e PDV Legal e atualiza os alertas. `complete` exige provisionamento concluído, e-mail entregue, senha criada e alertas obrigatórios resolvidos; então marca `completed`/`done`. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| Firebase Auth, `users`, perfis/unidade/cargo/turno no banco principal | Criação e configuração da conta | `onboarding.manage`, pré-requisitos da etapa e perfil padrão. |
| `employees`, documentos e consentimentos no banco RH | Cadastro e promoção de documentos | Função de criação; origem `recruitment_onboarding`. |
| `onboardingProcesses`, `firstAccessLinks`, e-mail | Estado da integração, token e entrega | Rota, webhook e transação de avanço. |
| Bizneo e PDV Legal | Busca e associação de IDs | `verifyAccessIntegrations`, conclusão bloqueada por alertas pendentes. |

**Inferência de impacto:** Auth, banco principal, banco RH, e-mail e integrações externas não compartilham transação. A rota só grava `collaboratorUserId` no processo após a função de criação retornar; falha intermediária pode deixar conta/cadastro criado sem o ponteiro final. Conferir idempotência e origem da conta antes de retentar. Mudanças em perfil padrão ou promoção documental afetam o primeiro acesso e o arquivo do colaborador.

## Verificação e limites

Os [testes de integração de RH](../../../tests/unit/hr-onboarding) são pontos de partida; não demonstram entrega real do e-mail, uso do link e sincronização externa. Para mudanças, conferir pré-requisitos PJ/não PJ, conta existente, perfil, promoção, token, estado de entrega, senha usada e alertas Bizneo/PDV. O percurso detalhado do contador e das assinaturas anteriores permanece pendente.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Limite da base principal

A main não contém comparação de versão/outbox da correção local anterior nem a opção `persistOnboarding: false`. Conferir gravação do gerador de primeiro acesso e do handler separadamente. Conta, token, metadados e e-mail não compartilham uma transação global; falha parcial e retomada permanecem casos pendentes. Ver [controle de etapas](onboarding-stage-control.md).
