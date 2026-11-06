# 0008 · Acervo com abas Empresa e Colaborador, busca por termos e botões Gerar/Criar

**Status:** decidido · 06/11/2026

**Decisão:** as abas do Acervo passam a ser **Empresa** e **Colaborador**, e cada uma só procura no que mostra.

- **Empresa** (`/dashboard/documents`): abre direto nas pastas da empresa, sem o nível "Empresa" antes. A pasta "Colaboradores" saiu daqui. O endereço antigo `/dashboard/documents/company` redireciona e mantém `?category=`, `?folder=`, `?unit=` e `?document=`.
- **Colaborador** (`/dashboard/documents/collaborators`): substitui a antiga "Ficha do colaborador" (`/published`, que redireciona) e a pasta Empresa › Colaboradores.
  - Sem pessoa aberta, quem vê a equipe escolhe numa lista com foto, busca e o filtro rápido **Ativos | Desligados** (`Segmented`; começa em Ativos).
  - Com pessoa aberta: cabeçalho com foto, nome, contagem e `Trocar colaborador`; as pastas aparecem nos três modos da [decisão 0007](0007-modos-do-acervo.md).
  - Quem gerencia a equipe vê **todos** os documentos da pessoa; os publicados levam a marca **Publicado** (o que ela vê no portal). Todas as pastas padrão aparecem, inclusive vazias (nome apagado e "Vazia").
  - Quem só tem acesso ao próprio perfil abre direto na própria pasta, com o que foi publicado para ele, e só vê pastas que têm documento.
- **Busca** (`ArchiveSearchInput`): fica na barra de cada aba e filtra enquanto se digita. A busca é por termos, sem diferença de acento ou maiúscula; todos os termos precisam aparecer, em qualquer ordem, e "aspas" mantêm uma frase junta (`src/lib/documents/archive-search.ts`). Ela alcança todas as pastas da aba, não só a pasta aberta: na Empresa, documentos e pastas da empresa; no Colaborador, os documentos e pastas da pessoa aberta (ou os nomes, na lista de pessoas). Cada resultado mostra onde está. Campo vazio e sem foco mostra um exemplo que se digita e se apaga sozinho; com `prefers-reduced-motion`, o exemplo fica parado.
- **Gerar documento** e **Criar documento** são dois botões no topo do Acervo, porque são funcionalidades diferentes: Gerar abre o gerador (documentos do sistema a partir dos dados); Criar abre um menu com **Usar modelo** (modelos publicados do editor) e **Novo documento** (em branco).

**Motivo:** pedido do programador em 06/11/2026: menos níveis até a pasta, um só lugar para os documentos de cada colaborador e busca que ache o documento sem precisar saber a pasta.

**Substitui:** na decisão 0007, as abas "Pastas | Ficha do colaborador", as abas por pasta e os chips de subpasta da Ficha e a busca "nesta pasta". Os três modos de visualização continuam.

**Pendente:** a página antiga de documentos do DP (`/dashboard/dp/collaborators/[userId]/documents`), com Anexar documentos, revisão por IA, status e versões, e a configuração de Visibilidade em `/dashboard/dp/documents` ainda existem; o botão **Gerenciar pasta** leva a ela. A mudança das funções para a aba Colaborador e o redirecionamento dos caminhos antigos são a etapa seguinte.
