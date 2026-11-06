# 0007 · Modos de visualização do Acervo e Ficha do colaborador

**Status:** decidido · 05/11/2026

**Decisão:** o Acervo tem duas abas no topo, **Pastas** e **Ficha do colaborador**.

**Pastas** oferece três modos de visualização, escolhidos no seletor `Modo de visualização` (`Segmented`) e lembrados neste navegador (`localStorage`, chave `coala.acervo.modo`):

- **Painel lateral** (principal e padrão): tabela larga; clique numa pasta entra nela; clique num arquivo abre o `SidePanel` com prévia, dados e ações (Ampliar prévia, Baixar, Renomear, Mover etc.). Segue o padrão das listas (`LiftRow` + `SidePanel`), sem ícones de ação na linha.
- **Clássico**: tabela larga no estilo do gerenciador de documentos do Bizneo; primeira linha "Pasta atual"; clique no nome abre (arquivo abre a prévia ampliada); menu `⋯` visível em cada linha.
- **Cascata**: colunas como no Finder do Mac; cada pasta aberta vira uma coluna à esquerda, e clicar numa coluna anterior volta para aquele nível; a prévia e as ações ficam na última coluna. Colunas anteriores só existem para pastas abertas nesta tela (um link direto começa a cascata na pasta atual).

Nos três modos, voltar para uma pasta anterior é pela **trilha em pílula** (`Caminho da pasta`), clicável em cada nível, e pelo voltar do navegador. Os botões Voltar e Pasta acima, a árvore lateral e a grade de ícones saíram. `Alt+↑` sobe uma pasta pelo teclado. Ícones são neutros (`--ds-ink-muted`) e variam pelo tipo: pasta, pasta aberta, PDF/texto, imagem, planilha, modelo.

**Ficha do colaborador** (antiga pasta "Colaboradores" da raiz, rota `/dashboard/documents/published`): mostra os documentos publicados ou compartilhados com a pessoa, exatamente o que ela vê no portal. Sem pessoa escolhida, lista os colaboradores com busca; com pessoa, mostra cabeçalho (foto, nome, quantidade) e o seletor `Trocar colaborador`. As pastas de primeiro nível viram abas com contador; o segundo nível (ano, período aquisitivo, etc.) vira chips; a busca alcança a ficha inteira. Clique no documento abre o `SidePanel` com prévia e ações. Quem não tem acesso à equipe abre direto a própria ficha, sem seletor.

**Motivo:** escolhido pelo programador entre seis alternativas comparadas no protótipo de 05/11/2026 (Tabela no estilo Bizneo, Acervo atual refinado, Tabela com painel lateral, Ficha com abas, Cartões de pasta e recentes, Colunas em cascata), depois da leitura do gerenciador de documentos do Bizneo usado pelo DP.

**Substitui:** em [gerenciador-de-documentos.md](../gerenciador-de-documentos.md), "clique simples seleciona; duplo clique abre", a prévia acoplada fixa ao lado da lista e "pastas aceitam grade ou lista". Permissões, origens, APIs e regras de pasta continuam iguais.

**Abrange:** todas as áreas que usam `ArchiveExplorer` (raiz, Empresa, Colaboradores internos, Financeiro institucional, Modelos) e a Ficha do colaborador. Outras telas de arquivos não mudam sem nova decisão.
