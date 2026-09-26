# Integração: formulário, envio e retorno da contabilidade

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Assinatura e ativação ficam em outros guias.

## Entrada e percurso

A [tela de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) usa [`/api/hr/onboarding/[id]/accountant-workflow`](../../../src/app/api/hr/onboarding/%5Bid%5D/accountant-workflow/route.ts). `GET` exige `accountant.view` e consulta estado/eventos ou entrega formulário/ficha. `PATCH` e o upload interno por `POST` exigem `accountant.manage`.

1. `set_monthly_salary` exige ainda `sensitiveData.view`; `set_form_data` valida campos revisados, inclusive CNPJ e estado civil. Alterações invalidam a versão atual do formulário. `validate_form` exige remuneração, versão não obsoleta e formulário existente; grava validação no processo, no documento gerado e em evento. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/accountant-workflow/route.ts).
2. `confirm_documents` exige formulário validado e seleção de documentos opcionais aprovados e auditáveis. `send_email` revalida seleção, ASO aprovado, documentos obrigatórios e versão do formulário; baixa os anexos do Storage, confere limite total de 35 MB e envia e-mail com formulário, ASO e documentos selecionados. Registra `emailCommunications`, hash de token e prazo de 30 dias para o [portal do contador](../../../src/app/contador/ficha-registro/%5Btoken%5D/page.tsx). [API pública](../../../src/app/api/hr/accountant/%5Btoken%5D/route.ts).
3. O contador envia a ficha de registro pelo portal. A API pública valida token/prazo e usa [`storeAccountantRegistryUpload`](../../../src/features/hr/accountant/registry-upload.server.ts). O RH pode anexar a ficha pelo `POST` interno, após preflight e checagem de duplicidade. `review_registry` aprova ou rejeita a ficha recebida; aprovação avança à próxima etapa calculada pela trilha, rejeição mantém a ficha para correção. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/accountant-workflow/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `onboardingProcesses`, `generatedDocuments`, `accountantEvents` no banco RH | Formulário, seleção, validação, retorno e etapa | Permissões `accountant.view`/`manage`; remuneração exige `sensitiveData.view`. |
| Storage, e-mail e `emailCommunications` | Anexos, envio e ficha retornada | Versão/hash, tamanho e token; efeitos externos separados das projeções. |
| `accountantTokenHash` | Acesso temporário ao portal público | Hash e expiração em 30 dias. |

**Inferência de impacto:** alterar salário, campos, versão do formulário ou seleção sem invalidar/conferir a versão pode enviar um pacote desatualizado. E-mail, Storage e banco RH não compartilham transação; conferir aceite, token e estado do processo ao tratar falhas. A [revisão documental](onboarding-public-documents.md) e a aprovação do ASO antecedem o envio.

## Verificação e limites

Os [testes de onboarding](../../../tests/unit/hr-onboarding) são ponto de partida. Para mudanças, conferir permissão sensível, versão gerada, seleção, ASO, limite de anexos, token vencido, duplicidade da ficha, aprovação e transição de etapa. Este guia não demonstra entrega real do e-mail nem upload real no portal.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
