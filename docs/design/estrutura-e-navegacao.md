# Estrutura de página e navegação

Destino arquitetural das telas internas. Este documento orienta migrações futuras; o PR do guia não altera os componentes de layout nem telas operacionais.

## Fundo e largura

O destino visual usa `--ds-bg-page` (#f0eee9) atrás do conteúdo e dos modais. Cards usam `--ds-surface`; formulários de modal usam `--ds-surface-input`.

| Variante de `PageContainer` | Máximo | Uso pretendido |
|---|---:|---|
| `compact` | 1220px | formulários e fluxos lineares |
| `default` | 1440px | páginas comuns |
| `wide` | 1600px | listas, relatórios e tabelas densas |
| `fluid` | sem limite | superfícies espaciais justificadas |

Adotar `PageContainer` em toda página interna é objetivo de longo prazo, não critério deste PR. A prop `surface` ainda existe e só pode ser removida quando todos os consumidores forem migrados e testados.

## Cabeçalho e retorno

O destino é título 24/800, retorno quadrado de 36px e contexto no breadcrumb superior. Ações de listas ficam no painel de controle; formulários e detalhes sem lista podem manter ações no cabeçalho.

O retorno deve preferir um `returnTo` interno validado, depois histórico comprovadamente interno, e por fim `fallbackHref`. `history.length` sozinho não prova origem. A implementação desse contrato em `PageHeader`, `BackButton` ou tracker fica fora deste PR.

## Painel de controle

Telas de lista usam uma casca escura com contexto, indicadores ou abas, busca, filtros, ações e chips. Tudo que filtra a lista fica no painel; ações sobre um item ficam no `SidePanel`.

O guia entrega `ControlPanel` e `ControlIndicator` isolados. `ControlIndicator` recebe `tone` semântico, nunca uma cor hexadecimal. Unificar esse componente com implementações operacionais requer uma migração separada.

## Hierarquia de ações

- uma ação principal por área;
- página: `primary-page`; modal: `primary-modal`;
- ações secundárias do guia: `ds-secondary`, `ds-ghost` e `ds-link`;
- destrutivo no fim do contexto e protegido por `InlineConfirm`;
- estado desabilitado explica o motivo.

## Status e progresso

Status visível informa se a pessoa ainda precisa agir. Verde significa conclusão real. Estados intermediários revisados mas não efetivados continuam pendentes; estados fora do fluxo usam `neutral`.

Fluxos em etapas podem usar a linguagem do `WizardModal`, mas o servidor deve revalidar qualquer condição de bloqueio. Compartilhar aparência não transfere regra de negócio para a interface.

## Acessibilidade

- controles têm nome acessível e foco visível;
- segmentados suportam setas, Home e End;
- linha clicável pura não contém controles interativos;
- linha com ações usa `LiftRow interactive={false}` e oferece um botão explícito para abrir o item;
- confirmações inline recebem foco inicial e devolvem foco ao acionador;
- painéis e modais usam Radix Dialog e respeitam Esc;
- movimento respeita `prefers-reduced-motion`;
- erro é ligado ao campo e anunciado, nunca exibido por diálogo nativo.
