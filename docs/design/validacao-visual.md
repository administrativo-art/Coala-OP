# Validação visual

27/11/2026 — registro do mês da pessoa no Fechamento do ponto (fase 1): E2E Chromium headless com Auth/Firestore demo e respostas simuladas do fechamento (`node scripts/test-e2e.mjs --time-closure-record`). Foram inspecionadas, a 1280 px, as capturas do registro, dos cartões abertos e da visão da organização, no registro privado `2026-11-26-fechamento-telas`; a inspeção antecede ajustes de texto e filtros pedidos pela revisão de ponto, cobertos pelo mesmo E2E sem nova inspeção. Largura de celular, teclado e dados reais não foram conferidos.

17/11/2026 — calendário anual da Conciliação de vendas: cenário de navegação do calendário passou em Chromium headless com Auth e Firestore no projeto demo. Foram inspecionadas as capturas `calendario-anual-1440.png`, `calendario-anual-1920.png` e `calendario-anual-390.png` no registro privado `20261117-sales-source-warnings/ui-evidence`. As larguras mostraram três, quatro e uma coluna, respectivamente, com o cabeçalho, os filtros e a legenda no mesmo fluxo da página. O cenário sintético cobriu dia fechado, dia reaberto e acesso à visão mensal. As capturas antecedem a correção do singular nas contagens dos chips.

10/11/2026 — guia interativo de metas no dashboard web: E2E Chromium headless com Auth/Firestore demo conferiu a página autenticada em 390, 768 e 1280 px, 14 seções, ausência de PDF exposto e ausência de rolagem lateral no componente. A primeira captura de 390 px revelou o faturamento cortado na barra fixa; a disposição foi ajustada e o E2E passou novamente. Capturas em `test-results/goal-guide-{390,768,1280}.png` do worktree local. Não houve teste em aparelho físico nem no aplicativo Android. Na mesma data, a disposição passou para a largura do `PageContainer`, painel escuro com os controles da simulação, colunas internas e cabeçalho dos quadros em faixa clara, escolhidos pelo usuário entre protótipos na prévia local; o E2E foi repetido com sucesso.

03/11/2026 — inventário pessoal no painel existente de Privacidade: E2E Chromium headless com Auth/Firestore demo passou em dois cenários de vínculo opcional por ID, consulta por origem/paginação e restrição/erro/resposta antiga. A captura `ui-evidence/inventario-pessoa.png` está no registro privado `person-traceability-20261103`; foi inspecionada a fila A–Z, o vínculo explícito, a leitura dos registros no painel rolado e os detalhes de auditoria recolhidos. O full-page cobre a fila e o trecho visível do drawer, não certifica toda geometria/foco. Teste manual mobile e teclado dispensado pelo desenvolvedor, não executado. Nenhum navegador do usuário ou dado real foi acessado.

02/11/2026 — correção Empresa/Colaboradores: `node scripts/test-e2e.mjs --document-archive` passou em dois cenários no Chromium com Auth/Firestore demo, incluindo 12 - Colaboradores dentro de Empresa, caminho de retorno, ordenação e sete referências sintéticas do mesmo kit apresentadas como um arquivo. Nenhum navegador do usuário ou documento real foi usado; a assinatura externa não foi exercitada.

02/11/2026 — árvore revista do Acervo: E2E local com emuladores demo passou em dois cenários, incluindo categorias principais numeradas só em Empresa, Jurídico, Financeiro/Modelos aninhados, biblioteca realocada no Gerador, retorno das pendências ao Acervo e PDF gerado no dossiê. Capturas `acervo-empresa.png` e `acervo-modelos.png` ficam no registro privado da tarefa acervo-tree-20261102. Não houve navegador do usuário nem acesso a documentos reais; dados de origem são sintéticos.

O guia isolado possui contratos de código e deve ser inspecionado visualmente antes de qualquer adoção operacional. Toda tela real migrada no futuro será comparada com o protótipo pertinente antes do merge.

**Estado do guia isolado:** validação visual aceita pelo solicitante em 07/10/2026. A validação detalhada das telas operacionais permanece segmentada por módulo e só acontece quando cada adoção for solicitada.

## Referências

02/11/2026 — correção do Acervo: capturas em Chromium com dados sintéticos em `test-results/documents-archive-*/acervo-empresa.png` e `acervo-modelos.png`, preservadas no registro local do chamado antes de encerrar o worktree. Inspecionadas árvore, caminho, barra de busca/ordenação, arquivo selecionado e biblioteca no mesmo ambiente. E2E dirigido cobre as quatro áreas e largura de 390px, além de prévia de PDF, página seguinte/anterior, contexto e retorno. Não é homologação de dados reais, upload ou assinatura externa.

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

## Coala Go — handoff Android (11/10/2026)

O handoff `Coala One App - Prototipo.dc.html` é referência visual para Compose,
não uma autorização para importar runtime web, simular sucesso ou trocar APIs.
Nome exibido: Coala Go. Fonte/tokens e movimento são descritos no
[README nativo](../../apps/coala-one-android/README.md#handoff-visual-nativo).
Validação local usa emulador Android 15/API 35, simulação nativa sem produção,
`DesignScreensTest` para capturas das sete telas e navegação de Metas/Escala,
`DesignMotionTest` para avanço de frames, modo estático e marca/slogan a 160%,
além dos testes Compose dos fluxos de negócio. A janela é liberada para captura
somente pelo teste; FLAG_SECURE permanece no release.

Divergências intencionais: Coala Go substitui One na marca; Signage e ações
operacionais permanecem disponíveis; contagens/valores/permissões são reais;
limites de anexos e consequências das confirmações seguem o backend, não o
mock. A aurora usa gradientes radiais suaves (API 26), sem blur de API 31.
Não há moldura de telefone, status bar falsa, relógio fictício ou navegação de
preview dentro do app. Não foi aberto navegador para renderizar o protótipo.
Os pares de texto seguem os tokens com contraste registrado em `tokens.md`;
gradientes são usados na marca grande/ilustrações/progresso, sem substituir
mensagens ou rótulos das ações. O aceite em aparelhos físicos permanece pendente.

## Prestadores de serviço — 23/11/2026

Portal do Contador e ativação de convite verificados em Chromium local com respostas simuladas, nos tamanhos1280px e390px. O teste percorreu login, ativação, lista de competências e confirmação administrativa de suspensão. A gestão usa campos e botões do sistema, seletor com chevron e cartões que se empilham no celular. Capturas privadas no registro local da tarefa; sem rolagem horizontal ou erros de página. O servidor de teste foi encerrado e o caminho temporário de QA removido. Publicação e operação com contas reais pendentes.


## Fechamento individual no Portal do Contador — 23/11/2026

Verificação em Chromium local com APIs simuladas: seleção de empresa e competência, lista de colaboradores, abertura do fechamento, download protegido do contracheque e suspensão de conteúdo após reabertura. A gestão percorreu prévia e confirmação explícita de liberação. Trocar de empresa remove o detalhe anterior. Capturas desktop e celular foram inspecionadas, com campos identificados e sem rolagem horizontal. Evidências privadas no registro local da tarefa. Caminho temporário e servidor de QA removidos após a verificação; publicação pendente.


## Conferência do contracheque retornado — 23/11/2026

Playwright do repositório no app local e emuladores demo, com APIs simuladas para percorrer seleção de entrega, download protegido, transcrição explícita, comparação divergente, registro e correção. O envio fica ausente enquanto pendente/divergente/obsoleto e aparece após conferência compatível; o teste confirmou o envio explícito e a retirada do botão após mudança de fonte. Capturas desktop e390px inspecionadas, com rótulos nos campos e sem rolagem horizontal. A rota temporária de QA e o servidor foram removidos; capturas e logs privados no registro da tarefa. Homologação com arquivos reais e publicação pendentes.


Conciliação financeira da folha (23/11/2026): Playwright do repositório no app local com emuladores demo e APIs simuladas percorreu salário divergente, registro, correção, guia, naturezas individuais, download e confirmação. Um cenário passou em 33,3s; desktop e 390px sem rolagem horizontal. Capturas privadas inspecionadas; endpoints reais sem sessão 401. Sem pagamentos reais ou navegador do usuário. Rota e scripts temporários removidos após QA; publicação e homologação real pendentes.


Revisão do formulário da guia: quatro campos explícitos de identidade do PDF (tipo, número, CNPJ e competência), sem copiar os valores esperados como transcrição. O número esperado no título aparece somente como referência de conferência; PDF múltiplo não é oferecido. Teste dirigido de identificação divergente/correção acompanha a evidência local.
