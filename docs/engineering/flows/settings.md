# Configurações gerais e unidades

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

A [página de configurações](../../../src/app/dashboard/settings/page.tsx) seleciona abas conforme permissões. Ela monta gestão de cadastros, DP, perfis, financeiro, compras, preços, metas, privacidade, bio pública, IA e sincronização PDV. A [página de unidades](../../../src/app/dashboard/settings/units/page.tsx) exige `settings.view`, usa `DPRuntimeGuard` e monta [`DPSettingsUnits`](../../../src/components/dp/dp-settings-units.tsx). Este componente combina `useDP`, `useDPBootstrap`, `useHrBootstrap` e `useKiosks`; edição é mostrada a quem tem `settings.manageUsers`, `settings.manageKiosks` ou `dp.settings.manageUnits`.

As abas têm contratos próprios: [DP](dp-configuration.md), [acesso/perfis](people-access.md), [cadastros](registry.md), [preços](pricing.md), [metas](goals.md) e [PDV](pdv-sync.md). A seleção da aba não comprova permissão de escrita de cada serviço; verificar endpoints e regras Firestore por ação. Alterar unidade ou quiosque pode afetar escala, reposição, financeiro, vendas e escopo de acesso. Faltam auditoria de cada aba, propagação de ID de unidade, integrações e validação das permissões no servidor. `npm run check` passou; testes de navegação/seleção de aba não verificam esses efeitos.

## Contratos por família de configuração

A [composição das abas](../../../src/app/dashboard/settings/page.tsx) aponta para componentes especializados. Para investigar uma alteração, seguir a família correspondente; a permissão para ver configurações não substitui o controle da gravação.

| Família | Caminho detalhado e efeito |
| --- | --- |
| Itens, insumos, entidades | [Cadastros](registry.md): catálogo compartilhado, normalização e referências de compras/estoque. |
| Turnos, calendários, cargos, funções, perfis e login | [DP](dp-configuration.md), [organização](organization.md) e [acesso](people-access.md): mudanças de configuração e concessão de acesso têm pontos de escrita diferentes. |
| Planos de contas, centros, contas bancárias, descrições e aliases | [Despesas](expenses.md), [fluxo de caixa](cash-flow.md), [pagamentos](payment-requests.md): classificações e mapeamentos usados por lançamento, importação e conciliação; alterar cadastro não executa pagamento. |
| Compras e parâmetros contábeis | [Compras](purchasing-order-receipt.md): seleção de parâmetros na geração de despesas e confirmação. |
| Preços, concorrentes, comparações e metas | [Preços](pricing.md) e [metas](goals.md): fórmulas/overrides e consumidores de vendas. |
| PDV e catálogo QR | [PDV](pdv-sync.md) e [catálogo](catalog.md): sincronização e publicação têm contratos próprios. |
| Etiquetas de patrimônio e formulário de talentos | [Patrimônio](assets.md) e [recrutamento](recruitment.md): sequência de códigos e campos públicos. |

### Unidades e perfis

[`useDPStore`](../../../src/store/use-dp-store.ts) envia CRUD de unidades às APIs e atualiza estado local; criação/edição solicitam sincronização de projetos de formulários depois. O [PATCH da unidade](../../../src/app/api/dp/units/[unitId]/route.ts) exige `requireOperationalUnitManager`, valida campos/CNPJ e grava unidade e vínculo PDV do quiosque em batch quando aplicável. DELETE consulta referências em usuários, turnos e escalas e bloqueia exclusão se houver vínculo; consultas e remoção são separadas, e não cobrem automaticamente todos os consumidores históricos de outros bancos. Arquivar e registrar fusão não migra todas as referências.

[`ProfilesProvider`](../../../src/components/profiles-provider.tsx) usa listener e CRUD direto em `profiles`, incluindo manutenção de permissões administrativas. As regras Firestore são o controle dessas escritas; propagação até claims/cache de sessão precisa de verificação integrada no [fluxo de acesso](people-access.md).

### Bio pública, IA e privacidade

A [API da bio](../../../src/app/api/settings/public-bio/route.ts) usa `requireBioManager`, schema e revisão esperada. Salvar altera rascunho; publicar valida links/imagens e grava snapshot publicado em transação com controle de revisão. Upload de mídia é separado. A publicação consome a versão publicada, não cada edição de rascunho.

A [consulta de gestão de IA](../../../src/app/api/settings/ai-management/route.ts) exige administrador padrão ou `settings.view` com `settings.viewAiCosts`; relatório de custo não implica autorização para alterar cobrança no provedor.

Os endpoints de [solicitações de privacidade](../../../src/app/api/privacy/requests/route.ts) e [incidentes](../../../src/app/api/privacy/incidents/route.ts) usam [`requirePrivacyUser`](../../../src/app/api/privacy/_lib.ts), gravam `privacyRequests`/`securityIncidents`, prazos e auditoria. A guarda admite permissões alternativas, inclusive `settings.view`; não presumir acesso exclusivamente administrativo. Textos/checklists exibidos nas configurações não comprovam auditoria de segurança nem regra de retenção aprovada. Testar permissões, concorrência de revisão/publicação e referências de unidades no item 2.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Orçamentos por categoria e projeto

Configurações gerais e financeiras montam `BudgetsManagement`; edição na interface depende de `financial.settings.manageBudgets`. APIs aplicam `budgetActor` e schemas, com transações de orçamento/reservas, revisões de limite e vínculos de despesa em projetos. Job diário gera por regra/competência. Fontes, permissões e verificações estão no [guia de orçamentos](financial-budgets.md).
