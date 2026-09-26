# Início da integração de prestadora PJ

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** fluxo de criação traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe`, em 2026-09-25. Este guia não cobre as oito etapas posteriores da integração PJ nem estabelece regra de negócio aprovada; veja [regras](../business-rules.md). O ciclo posterior está no [fluxo PJ](onboarding-pj-workflow.md); o grupo está traçado, com verificação integrada pendente.

## Escopo e entradas

A tela [`hr/recruitment/integration/page.tsx`](../../../src/app/dashboard/hr/recruitment/integration/page.tsx) monta `RecruitmentShell`. O formulário `PjOnboardingStartForm` em [`recruitment-onboarding-view.tsx`](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) coleta CNPJ da prestadora, nome, e-mail, empresa contratante, datas, valor mensal, dia de pagamento e frentes/entregáveis. Envia `POST /api/hr/onboarding` com `employmentRelationshipType: 'pj'` por `apiFetch` autenticado. A entrada principal `hr/recruitment/page.tsx` mostra aviso de construção em produção; a página de integração é uma rota distinta. [Matriz de páginas](../flow-matrix.csv).

## Percurso observado

1. [`POST`](../../../src/app/api/hr/onboarding/route.ts) chama `assertFormalizationAccess(request, 'onboarding.manage')`, retorna 403 se não houver acesso e seleciona `createPjOnboarding` para vínculo `pj`.
2. `createPjOnboarding` valida CNPJ, nome e e-mail da prestadora, unidade contratante, data de início, prazo, valor mensal positivo, dia de pagamento de 1 a 31 e ao menos uma frente com entregável. Consulta `dbAdmin.collection('dp_units')` e rejeita unidade arquivada ou sem CNPJ válido. Busca outro `onboardingProcesses` ativo para o mesmo CNPJ e retorna 409 se encontrar. [Fonte](../../../src/app/api/hr/onboarding/route.ts).
3. A rota cria um ID/token público, a versão inicial do template de integração e o `pjWorkflow`, depois grava em `hrDbAdmin.collection('onboardingProcesses')` status `collecting_documents`, estágio `documents`, vínculo `pj`, dados da unidade, documento e configuração inicial. A construção do estado PJ está em [`onboarding-pj/core.ts`](../../../src/features/hr/onboarding-pj/core.ts).
4. Após gravar, chama [`logAction`](../../../src/lib/log-action.ts) com `onboarding_pj_created` e [`sendTrackedIntegrationCommunication`](../../../src/lib/email/integration-communications.ts) para comunicar o link público à prestadora. A resposta 201 devolve o processo salvo. [Fonte](../../../src/app/api/hr/onboarding/route.ts).

## Dados, acesso e efeitos

| Dado/efeito | Operação observada | Controle e fonte |
| --- | --- | --- |
| `dp_units` no banco principal | Leitura da contratante e do CNPJ | Validação de unidade não arquivada e CNPJ válido em [`createPjOnboarding`](../../../src/app/api/hr/onboarding/route.ts). |
| `onboardingProcesses` no banco RH | Consulta de duplicidade por CNPJ/status e criação do processo | `assertFormalizationAccess('onboarding.manage')` na rota; os campos/estados são gravados por [`createPjOnboarding`](../../../src/app/api/hr/onboarding/route.ts). |
| Auditoria e e-mail | Eventos após a gravação do processo | [`logAction`](../../../src/lib/log-action.ts), [`sendTrackedIntegrationCommunication`](../../../src/lib/email/integration-communications.ts). |

O registro, a auditoria e o envio são chamadas sequenciais, sem transação única entre banco e e-mail. **Inferência de impacto:** uma falha após a gravação pode deixar o processo criado sem a comunicação concluída; examinar retry/idempotência do serviço de comunicação antes de alterar esse caminho. O link público é consumido por [`api/hr/onboarding/public/[token]`](../../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts).

## Verificação e limites

[`hr-onboarding-pj-core.test.ts`](../../../tests/unit/hr-onboarding-pj-core.test.ts) verifica o estado inicial e regras do núcleo PJ. [`operational-status.test.ts`](../../../tests/unit/hr-onboarding/operational-status.test.ts) também usa a criação do estado PJ. Busca em `tests/` não encontrou teste direto da rota `POST` para auditoria/e-mail; isto é uma **lacuna de cobertura conhecida**, não prova de ausência de comportamento. Antes de mudar a criação, conferir também acesso do link público, comunicação e as etapas posteriores em [`api/hr/onboarding/[id]`](../../../src/app/api/hr/onboarding/%5Bid%5D).

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
