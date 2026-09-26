# Integração PJ: revisão, contrato, financeiro e ativação

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. A [abertura PJ](onboarding-pj-creation.md), o [cadastro público](onboarding-public-documents.md) e a [criação do acesso](onboarding-activation.md) têm guias próprios. Este guia registra o caminho entre eles.

## Entrada e transições

O [painel PJ](../../../src/features/hr/onboarding-pj/detail-panel.tsx) chama `PATCH /api/hr/onboarding/[id]/pj-workflow`; a [rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts) exige `onboarding.manage`, carrega `onboardingProcesses/{id}` e rejeita processo que não seja PJ ou não tenha `pjWorkflow`. O [modelo de etapas](../../../src/features/hr/onboarding-pj/core.ts) inicia na etapa `provider_registration`, após registrar a definição contratual na abertura.

| Etapa / ação | Validação e efeito observados |
| --- | --- |
| `registration_review`: `set_document_status`, `request_corrections`, `approve_registration` | RH aprova ou rejeita cada arquivo recebido. Uma devolutiva exige mensagem, marca documentos selecionados como rejeitados, reabre cadastro público, gera novo token se necessário e envia comunicação à prestadora. A aprovação exige campos cadastrais e todos os documentos obrigatórios aprovados; avança para `contract_preparation`. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts), [campos obrigatórios](../../../src/features/hr/onboarding-pj/core.ts). |
| `contract_preparation`: `save_contract_settings`, `generate_contract`, `approve_contract` | Salva representante da contratante, cidade e foro; valida dados dos dois lados, gera PDF versionado em Storage com hash SHA-256 e marca minuta. Somente minuta gerada pode ser aprovada; então avança para `contract_signature`. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts), [modelo PDF](../../../src/features/hr/onboarding-pj/contract-pdf.tsx). |
| `contract_signature`: `send_contract`, `reconcile_contract` | Envia a minuta aprovada à Autentique com dois signatários e registra `hrSignatureRequests`. A conciliação consulta o provedor; quando concluído e com URL assinada, baixa o PDF, grava cópia no Storage e avança para `financial_registration`. Caso contrário, registra progresso das assinaturas. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts), [provedor](../../../src/lib/autentique.server.ts). |
| `financial_registration`: `submit_finance`, `finance_return`, `finance_approve` | Contrato assinado é pré-requisito para envio; cria `hrNotifications` para o grupo financeiro. O Financeiro pode devolver com motivo ou aprovar, o que avança para `access_configuration` e altera o processo para `active`/`integration`. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |
| `access_configuration`: `save_access` | Exige nome, CPF, perfil válido e ao menos uma unidade ativa; recusa perfil administrador padrão. Se PDV Legal for necessário, exige unidade vinculada a filial e perfil existente no PDV. Salva configuração em `pjWorkflow.access` e `pdvAccess`. A criação da conta usa `create_collaborator` na [rota principal](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts), que exige aprovação financeira e acesso configurado, e avança para `provider_activation`. |
| `provider_activation`: `activate` | Exige usuário criado, primeiro acesso ao Coala One usado e, se necessário, acesso PDV Legal concluído. Marca etapa concluída, processo `completed`/`done` e fecha o token público. [Rota PJ](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |

`GET /api/hr/onboarding/[id]/pj-workflow` devolve o processo, a minuta ou o PDF assinado (`asset=signed_contract`) somente após `onboarding.manage`; os PDFs são servidos com `Cache-Control: private, no-store`. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts).

## Dados, acesso e impacto

| Componente | Escrita ou leitura relevante |
| --- | --- |
| `onboardingProcesses/{id}` no banco RH | `pjWorkflow` (etapas, revisão, contrato, financeiro e acesso), documentos, estado geral e token público. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |
| Firebase Storage | Minuta versionada e contrato assinado; arquivos recuperados pelo GET autorizado. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |
| `hrSignatureRequests`, Autentique | Pedido local e identificação do documento externo; `reconcile_contract` atualiza a cópia assinada. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |
| `hrNotifications`, perfis, `dp_units`, PDV Legal | Notificação ao Financeiro e validação dos acessos antes de criar a conta. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts). |

Cada `PATCH` concluído grava [auditoria](../../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts) com ação `onboarding_pj_*`. **Inferência de impacto:** envio de e-mail, Storage, Autentique, notificação e atualização do processo são operações separadas; se uma falhar entre efeitos externos e `ref.set`, o processo pode não refletir o efeito já realizado. Revisar retomada e duplicidade antes de mudar essas ações.

## Verificação e limites

Os [testes do núcleo PJ](../../../tests/unit/hr-onboarding-pj-core.test.ts) cobrem construção e avanço básico de etapas. Eles não demonstram o percurso completo com Autentique, Storage, notificação financeira, e-mail e PDV Legal. Para alterações, verificar autorização da rota, pré-requisitos por etapa, devolução, versionamento do PDF, conciliação da assinatura, aprovação financeira e ativação com e sem PDV. A revisão ponta a ponta permanece pendente.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
