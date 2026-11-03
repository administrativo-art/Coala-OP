# Gerenciador de documentos

Decisão posterior de 02/11/2026: a raiz do Acervo contém Empresa. **12 - Colaboradores** fica dentro de Empresa; nomes de pessoas e suas subpastas continuam sem números. Essa organização reúne arquivos internos sem mudar fonte ou acesso e substitui a árvore Empresa/Colaboradores descrita anteriormente. O portal do titular continua dependente de publicação explícita ou da política já configurada.

O gerenciador pode reproduzir as interações familiares de pastas de um computador sem expor a estrutura física do armazenamento. A árvore exibida é uma camada de organização; mover um item altera metadados de organização e auditoria, não o caminho privado do arquivo no Storage, sua política de acesso, categoria legal, retenção ou histórico de versões.

## Estrutura do módulo

- **Acervo** tem Empresa na raiz. Dentro de Empresa, as pastas principais recebem `01 - Nome`, incluindo `12 - Colaboradores`; Financeiro é uma pasta única, incluindo os arquivos institucionais e os acessos à caixa financeira. Modelos também fica em Empresa e conserva categorias internas sem numeração. Pessoas e seus diretórios não recebem prefixos. Entrar em uma pasta conserva barra de ferramentas, árvore, caminho, lista/grade e prévia acoplada; a organização visual não altera permissões, categoria persistida ou Storage.
- **Gerador de documentos** reúne geração por modelos e a biblioteca de criação, edição e publicação já existente. Os links antigos redirecionam ao novo local. Acervo → Empresa → Modelos consulta a mesma biblioteca. Criar do zero com editor timbrado e auxílio de redação por IA é uma evolução descrita no [plano do Gerador](../planos/plano-gerador-documentos.md); não se confunde com o mapeamento por IA já existente.
- **Fluxos e pendências** é a mesa de trabalho. As abas A classificar, Em preparação, Fluxos e Assinaturas representam dimensões independentes; um mesmo documento pode aparecer em mais de uma aba.
- **Histórico** apresenta fatos persistidos pelas origens e snapshots atuais claramente identificados. A interface não inventa uma linha do tempo quando a fonte legada não registra eventos.

Acervo não copia arquivos para uma coleção central. As telas centrais usam referências compostas por `source` e `sourceId`, preservam a fonte de verdade e encaminham a operação detalhada para o módulo proprietário.

## Interações de desktop

- clique simples seleciona um arquivo ou pasta; duplo clique abre;
- `Ctrl`/`Cmd` adiciona ou remove itens da seleção e `Shift` seleciona um intervalo;
- a movimentação entre pastas ocorre por **Mover para…**, com escolha explícita de destino; arrastar entre pastas não movimenta documentos;
- botão direito abre um menu contextual com as ações permitidas para o item: Abrir, Visualizar, Baixar, Renomear, Mover, Ver versões e Excluir;
- `Shift+F10` ou a tecla de menu abre o mesmo menu para navegação por teclado;
- `Enter` abre, `F2` renomeia quando permitido, `Esc` cancela e as setas percorrem os itens;
- em telas touch, toque abre e pressão longa mostra o menu contextual; não se exige duplo toque.

Toda ação do menu precisa ter equivalente visível e acessível. O menu de contexto é atalho, nunca o único caminho para uma operação.

## Regras de pasta

- **Documentos da empresa → Sistemas e conformidade → Regularidade do sistema de registro de ponto** reúne artefatos de regularidade técnica do REP-P; comprovantes individuais e espelhos de jornada pertencem a fluxos próprios. A existência de um arquivo nessa pasta não certifica conformidade legal.

- Pastas definidas pelo sistema podem ser consultadas, mas não renomeadas, removidas ou movidas.
- Pastas personalizadas podem ser criadas, renomeadas, movidas e arquivadas por quem tiver permissão de gestão documental.
- Um documento pode ser reorganizado apenas dentro dos destinos permitidos pelo seu tipo. A interface não permite usar arraste para contornar categoria, confidencialidade, escopo de unidade ou retenção.
- Mover uma versão move o grupo lógico inteiro. O histórico de versões não é separado acidentalmente.
- A movimentação registra origem, destino, autor e data na auditoria; falha no servidor desfaz a prévia otimista e informa o motivo junto do item.
- Soltar arquivo externo continua sendo upload e passa pela análise, deduplicação e classificação existentes; não é uma movimentação interna.

## Comportamento visual

- Barra de busca atua na pasta atual; o caminho é clicável em cada nível. Título/nome começa em A–Z e alterna para Z–A pelo cabeçalho ou seletor, em lista e grade.
- A prévia permanece acoplada ao explorador no desktop, com largura estável para não deslocar os alvos entre os cliques; no celular fica abaixo da lista. Esta composição de arquivos usa o comportamento de seleção/abertura deste guia, em vez da abertura imediata de SidePanel/LiftRow das listas administrativas.
- Modelos reutiliza a biblioteca de geração/publicação existente; não cria outro catálogo. PDF é renderizado no navegador a partir do binário já autorizado, com troca de páginas; ações preservam os serviços e as permissões da origem.

- pastas aceitam grade ou lista e mostram quantidade de documentos;
- o arraste de arquivo externo para a área de upload segue as validações do formulário; a navegação entre pastas não interpreta arraste como movimentação;
- o breadcrumb representa a pasta virtual atual e aceita navegação;
- ações destrutivas usam `InlineConfirm`; o menu nunca executa exclusão imediatamente;
- datas seguem `DD/MM/AAAA` e nenhum caminho técnico de Storage é apresentado como pasta do usuário.

## Contrato de implementação

O back-end deve validar o destino, o escopo do colaborador e a permissão em cada movimentação, gravar organização e auditoria na mesma transação e preservar o arquivo físico e seus hashes. A implementação é considerada completa apenas com testes de movimento permitido, destino proibido, concorrência, rollback da interface, teclado e menu de contexto.
