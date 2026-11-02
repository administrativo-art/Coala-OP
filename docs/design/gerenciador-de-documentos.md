# Gerenciador de documentos

O gerenciador pode reproduzir as interações familiares de pastas de um computador sem expor a estrutura física do armazenamento. A árvore exibida é uma camada de organização; mover um item altera metadados de organização e auditoria, não o caminho privado do arquivo no Storage, sua política de acesso, categoria legal, retenção ou histórico de versões.

## Estrutura do módulo

- **Acervo** é a entrada de consulta e organização. Ele apresenta Empresa, Colaboradores e Financeiro somente quando o perfil possui acesso à fonte correspondente e abre a interface especializada de cada fonte.
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

- pastas aceitam grade ou lista e mostram quantidade de documentos;
- o arraste de arquivo externo para a área de upload segue as validações do formulário; a navegação entre pastas não interpreta arraste como movimentação;
- o breadcrumb representa a pasta virtual atual e aceita navegação;
- ações destrutivas usam `InlineConfirm`; o menu nunca executa exclusão imediatamente;
- datas seguem `DD/MM/AAAA` e nenhum caminho técnico de Storage é apresentado como pasta do usuário.

## Contrato de implementação

O back-end deve validar o destino, o escopo do colaborador e a permissão em cada movimentação, gravar organização e auditoria na mesma transação e preservar o arquivo físico e seus hashes. A implementação é considerada completa apenas com testes de movimento permitido, destino proibido, concorrência, rollback da interface, teclado e menu de contexto.
