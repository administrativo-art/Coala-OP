# Início manual da integração não PJ

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** criação traçada no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. O ciclo posterior está nos [guias de integração](../flow-coverage.md). Esta página descreve código implementado, não uma [regra aprovada](../business-rules.md).

## Entrada e percurso

[`hr/recruitment/integration/page.tsx`](../../../src/app/dashboard/hr/recruitment/integration/page.tsx) monta `RecruitmentShell`. O formulário em [`recruitment-onboarding-view.tsx`](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) envia `POST /api/hr/onboarding` por `apiFetch` autenticado com pessoa, vínculo, cargo, função, unidades, turno, data, modelo de integração, configurações de finalização e eventual acesso ao PDV Legal.

1. [`POST`](../../../src/app/api/hr/onboarding/route.ts) exige `assertFormalizationAccess(request, 'onboarding.manage')`; vínculo `pj` segue o [fluxo separado](onboarding-pj-creation.md). Para os demais vínculos, a rota valida campos obrigatórios, vale-transporte, unidade e perfil PDV quando solicitados.
2. A rota consulta `jobRoles` e `jobFunctions` no banco RH; `dp_units`, `dp_shiftDefinitions` e `profiles` no banco principal. Confere existência, unidade ativa, CNPJ contratante válido, vínculo turno/unidade, CBO quando haverá documentos admissionais, compatibilidade cargo/função, perfil padrão e função-base salarial. Se houver acesso PDV, consulta perfis/filiais no PDV Legal. [Fonte](../../../src/app/api/hr/onboarding/route.ts).
3. Pode importar a versão publicada de um modelo de integração compatível ou criar snapshot vazio. Calcula salário configurado, experiência, etapas e documentos iniciais com [`recruitment-onboarding.ts`](../../../src/lib/recruitment-onboarding.ts) e módulos de [`features/hr/integration`](../../../src/features/hr/integration). Grava o processo em `hrDbAdmin.collection('onboardingProcesses')` com status `collecting_documents` e estágio `documents`. [Fonte](../../../src/app/api/hr/onboarding/route.ts).
4. Depois da gravação, registra `onboarding_created_manual` por [`logAction`](../../../src/lib/log-action.ts), envia comunicação rastreada com link público por [`integration-communications.ts`](../../../src/lib/email/integration-communications.ts) e retorna 201. O token público é tratado em [`api/hr/onboarding/public/[token]`](../../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts).

## Dados, acesso e contratos

| Área | Leitura ou escrita | Condição observada |
| --- | --- | --- |
| RH: `jobRoles`, `jobFunctions` | Leitura | Cargo/função existentes e compatíveis; salário e documentos dependem de sua configuração. |
| Principal: `dp_units`, `dp_shiftDefinitions`, `profiles` | Leitura | Unidade, CNPJ, turno e perfil válidos; mudanças nesses cadastros afetam novas integrações. |
| RH: `onboardingProcesses` | Criação | Somente após `onboarding.manage` e validações da rota. |
| PDV Legal, auditoria, e-mail | Consultas/efeitos externos | PDV apenas se solicitado; auditoria e comunicação ocorrem após a gravação. |

**Inferência de impacto:** como processo, auditoria e e-mail são operações sequenciais, uma falha posterior à escrita pode deixar estado parcial; verificar retry/idempotência antes de refatorar. A rota não trata essas operações como uma transação entre sistemas.

## Verificação e limites

Testes de políticas de integração em [`tests/unit/hr-onboarding`](../../../tests/unit/hr-onboarding) cobrem partes como pré-requisitos documentais e salário; não foi localizado teste direto de toda a rota `POST` no levantamento. Não presumir que criar o processo conclui a admissão ou concede acesso final. O vínculo PJ usa [outra validação e estado inicial](onboarding-pj-creation.md).

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
