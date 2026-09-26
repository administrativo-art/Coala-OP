# Integração: itens de treinamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** ação localizada e traçada no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Este endpoint gerencia itens; a política de conclusão da integração está em [ativação](onboarding-activation.md).

A [rota `PATCH /api/hr/onboarding/[id]/training`](../../../src/app/api/hr/onboarding/%5Bid%5D/training/route.ts) exige `onboarding.manage` e processo existente. `add` cria item com ID, rótulo, detalhe e ordem; `set_status` muda para `pending`, `current` ou `done` e registra `completedAt` quando concluído; `remove` exclui o item e reordena os restantes. Todos gravam `trainingItems` e `updatedAt` em `onboardingProcesses/{id}` no banco RH e devolvem a lista serializada. A [tela de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) é a entrada do usuário.

**Acesso e dependências:** a rota valida a permissão no servidor, mas não verifica no trecho observado se `itemId` de `set_status` ou `remove` corresponde a um item existente; nesse caso a lista pode permanecer igual e ainda ser gravada. **Inferência de impacto:** se treinamentos passarem a bloquear formalização, é preciso ligar a condição à transição de etapa, pois esta rota apenas gerencia a lista. Testes específicos dessa rota não foram confirmados neste levantamento; confira permissão, estados, ordem e persistência antes de alterar.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
