# Validação visual

O guia isolado possui contratos de código e deve ser inspecionado visualmente antes de qualquer adoção operacional. Toda tela real migrada no futuro será comparada com o protótipo pertinente antes do merge.

**Estado do guia isolado:** validação visual aceita pelo solicitante em 07/10/2026. A validação detalhada das telas operacionais permanece segmentada por módulo e só acontece quando cada adoção for solicitada.

## Referências

- Protótipos: `referencias/*.dc.html` no pacote de handoff; são referência, não código de produção.
- Capturas: `screenshots/` do pacote, geradas com a paleta v4.
- Guia vivo: `/dashboard/design`, somente para administrador.

## Marcadores entregues

Já existem `data-ui="page-header"`, `data-ui="page-title"` e `data-ui="page-description"` no `PageHeader` atual. Este PR adiciona:

- `control-panel`;
- `lift-row`;
- `side-panel`;
- `wizard-modal`;
- `status-pill`;
- `inline-confirm` e `design-guide` como auxiliares.

## Processo futuro por tela real

1. Preparar sessão autenticada e seed determinístico no projeto `demo-`.
2. Fixar relógio quando datas afetarem o resultado.
3. Conferir 1440×900 e 1920×1080 com `reducedMotion: "reduce"` e animações desabilitadas na captura.
4. Separar cenários de lista, painel lateral e modal; fechar uma sobreposição antes de abrir outra.
5. Salvar o teste em `tests/e2e/visual/`, diretório coberto pelo `playwright.config.ts`.
6. Anexar capturas ao PR e registrar divergência intencional em `decisoes/`.

Não existe hoje um fixture `tests/e2e/fixtures/auth.ts` nem um `seedEstoque` reutilizável. Um teste futuro deve criá-los ou reutilizar explicitamente o login dos E2E atuais; a existência do usuário no emulador não autentica a página automaticamente.

Os exemplos de fixture autenticado, seed de Estoque e Axe do handoff v5 pertencem à futura adoção operacional. Eles não são criados pelo PR isolado do guia, porque exigem dados, autenticação e cenários das telas reais.

## Checklist

- [ ] Fundo e superfícies usam tokens `--ds-*`.
- [ ] Não houve mudança acidental nas variantes shadcn preexistentes.
- [ ] Painel de controle, linha, painel lateral, modal e status expõem os marcadores esperados.
- [ ] Teclado percorre segmentado, linha pura, painel e modal.
- [ ] Esc fecha a sobreposição superior e devolve foco.
- [ ] Confirmação de descarte recebe foco em Cancelar.
- [ ] Nenhum texto ou controle novo depende só de cor.
- [ ] Todo par novo de texto/fundo foi calculado e registrado em `tokens.md`.
- [ ] Estados de carregamento, vazio, erro e falta de permissão estão presentes quando aplicáveis.

## Testes de acessibilidade

O repositório ainda não possui `@testing-library/react`, `@testing-library/user-event`, `jest-axe` ou `@axe-core/playwright`. Este PR usa teste unitário puro para navegação do `Segmented` e contratos de fonte. A primeira adoção em tela real deve escolher explicitamente:

- Testing Library + user-event para foco e teclado em componente; e/ou
- Playwright + `@axe-core/playwright` para a página autenticada.

Axe é verificação adicional e não substitui inspeção de ordem de foco, rótulos, contraste e comportamento com leitor de tela.
