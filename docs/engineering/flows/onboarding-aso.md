# Integração: exame ASO, clínica e pagamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo principal traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. A rota também atende ASO demissional como sombra de um processo de desligamento.

## Entrada e percurso

A [tela de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) usa [`/api/hr/onboarding/[id]/aso-workflow`](../../../src/app/api/hr/onboarding/%5Bid%5D/aso-workflow/route.ts). `GET` exige `aso.view` e devolve fluxo/eventos ou guia, ASO, comprovante de pagamento e contrato social. `PATCH` exige `aso.manage` e distingue validação, pagamento, envio, agendamento e revisão.

1. `validate_request` exige clínica ativa e cadastro válido, dados essenciais da candidata, CNPJ/endereço da empresa, e-mail/preço/local da clínica. Congela snapshot e fingerprint da solicitação. `start_process` compara o fingerprint atual, confere guia, pagamento ASO da mesma origem/valor e pré-requisitos antes de iniciar o envio à clínica. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/aso-workflow/route.ts).
2. `validate_guide` vincula revisão à versão gerada. `request_payment` revalida o fingerprint e cria [`createPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) com `sourceType: aso`, além de notificação ao Financeiro. `refresh_payment` consulta/reconcilia a solicitação; `send_clinic_email` exige pagamento `paid` com comprovante e guia atual antes de enviar. O RH não autoriza o banco nesta rota. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/aso-workflow/route.ts).
3. `register_clinic_response` registra data, hora e local propostos. `confirm_appointment` envia e-mail à candidata e gera token temporário para o [portal de envio do ASO](../../../src/app/aso/candidato/%5Btoken%5D/page.tsx), servido pela [API pública](../../../src/app/api/hr/aso/candidate/%5Btoken%5D/route.ts). `review_aso` aprova ou rejeita o arquivo; com os demais documentos aptos, a aprovação pode avançar o onboarding para contador. Para `processKind: termination_aso`, projeta a revisão na etapa ASO do desligamento. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/aso-workflow/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `onboardingProcesses`, `asoEvents`, documentos gerados no banco RH | Estado, versões, guia, ASO, agendamento e eventos | `aso.view`/`aso.manage`; fingerprint antes de iniciar/pagar. |
| `asoClinicConfigs`, `entities`, `dp_units`, `companyDocuments` | Clínica, empregadora e contrato social | Validação da configuração antes de gerar/enviar. |
| Solicitação financeira, Banco Inter, e-mail e Storage | Pagamento, comprovante, comunicação e arquivos | Estados separados; e-mail à clínica exige pagamento confirmado. |
| `terminationProcesses` | Projeção do ASO demissional | Apenas para `processKind: termination_aso`. |

**Inferência de impacto:** mudanças em preço, clínica ou dados da candidata invalidam o fingerprint; ignorar essa ligação pode enviar guia ou pagamento inconsistentes. Bancos, e-mail e Storage não formam transação única; revisar estados após falha. A [etapa do contador](onboarding-accountant.md) depende de ASO aprovado.

## Verificação e limites

Os [testes de onboarding](../../../tests/unit/hr-onboarding) e [testes de ativos do fluxo](../../../tests/unit/hr-workflow-build-assets.test.ts) são pontos de partida; não comprovam pagamento real, e-mail ou upload do candidato. Para mudanças, conferir permissão, clínica, versão/fingerprint, origem/valor do pagamento, comprovante, agendamento, token, ASO e projeção no desligamento.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
