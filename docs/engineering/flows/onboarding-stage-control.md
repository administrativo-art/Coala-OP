# Integração RH: controle de etapas

**Base conferida:** main `70aaab65`; leitura estática, sem executar a cadeia integrada.

## Entrada e sequência

A [interface de integração](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx), montada pelo [shell](../../../src/components/hr/recruitment/recruitment-shell.tsx), envia ações para [PATCH /api/hr/onboarding/[id]](../../../src/app/api/hr/onboarding/[id]/route.ts). O handler usa autenticação/permissões e estado de `onboardingProcesses` no banco RH; verificar `onboarding.manage` e a permissão específica de revisão documental conforme a ação.

No ramo `advance_stage`, o destino é convertido para string e tipado como `OnboardingStageId`; a guarda rejeita destino vazio, mas não valida uma lista de valores reconhecidos em runtime. Guardas de saída: revisão documental deve passar pelo contador; contador exige aprovação; preparação/assinatura exige documentos concluídos; formalização exige configurações; saída da integração exige alertas resolvidos. Não há regra geral de adjacência. A [decisão aprovada](../business-rules.md) permite saltos e retrocessos, mas exige destino reconhecido: essa última garantia permanece pendente nesta base.

## Persistência e efeitos

A rota calcula `update`, grava o processo e audita em etapas separadas. Não contém `commitOnboardingUpdate`, comparação de versão, `auditOutbox` nem ação `retry_audit` da correção local anterior. Concorrência e falha entre escrita RH e auditoria no principal precisam de reprodução; não presumir commit único entre bancos.

[Primeiro acesso](../../../src/lib/first-access-links.ts) e [ativação](onboarding-activation.md) também produzem efeitos em Auth, banco principal, RH e e-mail. A opção `persistOnboarding: false` não pertence a esta base. A criação de link pode ocorrer antes de outras validações/efeitos do handler; conferir a ordem do ramo afetado antes de retentar.

## Dependências e verificação

Consultar [contador](onboarding-accountant.md), [assinaturas](onboarding-signatures.md), [ASO](onboarding-aso.md), [PJ](onboarding-pj-workflow.md) e [ativação](onboarding-activation.md). Testes disponíveis em [hr-onboarding](../../../tests/unit/hr-onboarding). Os testes de 162 combinações e auditoria recuperável do worktree anterior não estão incorporados. Para uma mudança, conferir destino inválido, guardas de saída, duas atualizações simultâneas e falha de auditoria, sem tratar teste unitário como execução de provedores reais.
