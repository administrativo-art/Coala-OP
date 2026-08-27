# Regras operacionais do Coala One

## Como tratar o código existente

- Código existente é evidência, não necessariamente padrão. Antes de copiar uma implementação, distinga decisão arquitetural intencional de convenção consolidada, solução local, detalhe histórico ou dívida técnica. Somente decisão e convenção comprovadas viram padrão.
- Na dúvida, não canonize. Preserve o comportamento existente, registre a incerteza e trate o ponto como não normativo. Solicite decisão apenas quando ela for necessária para prosseguir ou quando a alteração criaria um padrão global difícil de reverter.

## Padrão de construção de módulos

- Valide entrada por schema na fronteira do sistema. Nunca confie em dados enviados pelo cliente.
- Escritas que dependem de leitura prévia, alteram documentos correlacionados, executam transições de estado, recalculam agregados ou precisam manter auditoria atomicamente consistente devem usar transação no mesmo banco.
- Escritas simples, independentes e idempotentes podem usar `set`, `update` ou batch, conforme a garantia necessária. Não use transação apenas por simetria.
- Quando auditoria fizer parte da mesma unidade de consistência e estiver no mesmo banco, grave-a na mesma transação.
- Não trate operações entre bancos ou efeitos externos como se formassem uma única transação. Persista intenção e estado observável; execute o efeito externo com idempotência, retry e tratamento explícito de falha.
- Componentes não reinventam transporte nem autenticação. Chamada autenticada à API passa por cliente compartilhado. Hook de domínio só existe quando houver comportamento client-side que o justifique, como cache, estado compartilhado, optimistic update, paginação, revalidação, coordenação ou reuso.
- Nenhuma abstração nova sem antes procurar a existente. Se criar uma, registre no relatório por que a existente não servia.

## Protocolo de issue

- Antes de alterar código, caracterize o comportamento atual e reproduza a falha quando isso for tecnicamente viável.
- Classifique a issue como ocorrência isolada, regra de negócio, contrato entre componentes, integração, regressão, arquitetura ou ambiente/produção.
- Identifique o contrato ou invariante violado, as superfícies afetadas e o que está fora do escopo.
- Busque o menor nível de abstração que elimina a classe do problema, não apenas a ocorrência, sem overengineering.
- Uma issue não termina quando o caso reportado passa a funcionar; termina quando a regra violada volta a ser garantida por um artefato permanente.
- Antes de fechar, responda: "se amanhã outra implementação tocar neste componente, o que impede a falha de voltar?". Resposta aceitável é um artefato, como teste, tipo, schema, constraint, validação central, autorização no servidor ou regra no CI. "Corrigi aquela linha" não é.
- Não transforme hipótese em causa comprovada. Diferencie evidência, inferência e decisão.

## Observabilidade e tratamento de erros

- Erro esperado e erro inesperado são categorias diferentes. Erro interno não é mensagem pública, e nenhuma nova rota pode expor `error.message`, stack, causa ou metadados internos diretamente ao cliente.
- Toda falha inesperada capturada pela camada central recebe `eventId`; requisições instrumentadas recebem `requestId`; eventos técnicos passam por sanitização antes de qualquer sink.
- Observabilidade nunca pode quebrar o fluxo principal. Falha do sink, sanitizador ou resolução de release deve ser contida e não pode substituir a falha original.
- Auditoria de negócio não substitui observabilidade técnica. Preserve eventos de domínio e conecte-os por identificadores opacos quando útil.

## Agent Skills do projeto

- Skills próprias ficam nas localizações documentadas em `docs/engineering/agent-skills.md`; não crie cópias divergentes para clientes.
- `coala-error-triage` é de invocação explícita, escreve somente em `.ai-work/error-triage/` e nunca publica issues.
- Rede, publicação, push, deploy e automação externa não são presumidos.
- Toda alteração em skill exige `npm run skills:validate` e os testes relacionados.

## Verificação antes de concluir

- Nenhuma tarefa é considerada pronta sem executar as verificações aplicáveis.
- Mudanças comuns devem manter `npm run check` verde.
- Mudanças que afetem build, importações, fronteiras server/client ou geração de rotas devem manter `npm run verify` verde.
- Mudanças em regras de acesso ao Firestore exigem `npm run check:rules` verde.
- Mudanças cobertas por teste de integração exigem o respectivo comando verde.
- A IA não afirma que algo funciona sem ter executado a verificação. Não descreva como resultado aquilo que não rodou.
- Falhas preexistentes devem ser identificadas como preexistentes; não podem ser omitidas nem atribuídas à mudança sem evidência.

## CLI e navegador

- Para operações determinísticas, estruturadas ou repetitivas, prefira CLI ou script à automação do navegador.
- Antes de qualquer escrita, o script deve validar os dados e consultar duplicidades. Sempre que possível, deve ser idempotente e oferecer uma etapa de preflight/dry-run.
- O navegador é bloqueado por padrão para as IAs deste projeto. A IA só pode acessá-lo quando o desenvolvedor autorizar expressamente e o acesso for realmente necessário, ou quando o próprio desenvolvedor solicitar o uso do navegador, ainda que exista alternativa por CLI/API.
- A autorização vale apenas para a tarefa em que foi concedida e não deve ser presumida em tarefas seguintes.
- Não repita no navegador uma alteração que o script já confirmou. Quando o uso tiver sido autorizado, limite-o ao escopo solicitado e confira somente os dados necessários, como descrição, valor, competência, vencimento, unidade/centro de resultado, plano de contas e status.
- Quando uma ação necessária e segura estiver bloqueada por permissão, reautenticação ou confirmação pessoal, peça explicitamente ao desenvolvedor a autorização necessária pelo mecanismo disponível; não presuma recusa nem encerre a operação sem antes solicitar essa autorização.
- Depois de autorizado, a IA pode iniciar o fluxo de autenticação da CLI e deve aguardar o desenvolvedor concluir diretamente no provedor. Nunca solicite nem manipule senhas, códigos ou outros segredos no chat.

## Limpeza de scripts operacionais

- Todo script temporário ou de execução única deve ser removido ao final do trabalho, depois da execução e da validação do resultado.
- Antes de encerrar, remova também comandos temporários do `package.json` e arquivos auxiliares criados apenas para diagnóstico, preflight, migração pontual ou conferência.
- Rotinas realmente reutilizáveis do produto podem permanecer, desde que estejam nomeadas sem referência a uma ocorrência pontual, sejam idempotentes, tenham validação/preflight e estejam documentadas ou cobertas por testes.
- Nunca remova em massa arquivos antigos ou scripts de outra tarefa sem confirmar que são temporários e que não possuem uso pendente.

## Firestore, polling e controle de custo

- Antes de alterar queries, listeners, providers globais, rotas de listagem ou crons, faça um preflight de custo: documentos retornados por execução × execuções por hora × usuários/abas simultâneos × horas de uso por dia. Registre a estimativa no relatório da tarefa.
- Considere o crescimento futuro da coleção. Uma solução não pode depender de a coleção permanecer pequena.
- É proibido implementar polling periódico de coleções ou listagens completas. Quando polling for indispensável, consulte somente deltas, contagens ou conjuntos limitados e documente a frequência, o limite e o custo estimado.
- Não use `get()`, `getDocs()` ou `onSnapshot()` sem filtros e sem `limit`/cursor em coleções que possam crescer. Exceções exigem uma coleção comprovadamente pequena e limitada, com justificativa registrada.
- Providers montados em layouts globais não devem carregar coleções de negócio completas. Carregue dados somente nas rotas/componentes que os utilizam; em áreas globais, use resumos limitados ao usuário e ao estado ativo.
- Filtros de permissão, status, período, unidade ou workspace devem reduzir os documentos na consulta ao Firestore. Evite buscar a coleção inteira para só depois filtrar em memória; quando necessário, crie índices, consultas separadas ou projeções específicas.
- Rotas `GET` devem ser livres de efeitos colaterais. Não crie ou atualize defaults nem execute seeds/migrações durante uma leitura. Faça isso em migrações ou operações administrativas idempotentes.
- Registros concluídos ou históricos não devem participar de consultas operacionais recorrentes. Use status, período, arquivamento, paginação e cursores.
- Para tempo real, prefira listeners específicos, filtrados e limitados. Não substitua listener incremental por polling completo.
- Qualquer novo `setInterval`, listener Firestore, `getDocs()` ou `Query.get()` deve ser destacado antes do commit com a estimativa mensal de leituras e escritas.
- Antes do commit, revise ocorrências com `rg -n "setInterval|onSnapshot|getDocs|\\.get\\(\\)" src functions` e inspecione especialmente as linhas alteradas.
- Não faça rollout de consulta recorrente sem filtro, limite/paginação e estimativa de custo.

## Pagamentos bancários

- Agendar ou preparar um pagamento não autoriza sua execução.
- Nunca autorize, aprove ou confirme definitivamente um pagamento bancário sem uma solicitação específica e inequívoca do usuário para essa ação.
- No Banco Inter, a autorização final pertence ao usuário no aplicativo, salvo se ele der uma nova instrução explícita em sentido diferente.

## Revisão de permissões

- Sempre que uma alteração grande criar, mover ou ampliar módulos, páginas, rotas de API, ações sensíveis ou integrações, revise também o perfil de permissões antes do commit e do rollout.
- A revisão deve cobrir, no mínimo, visibilidade na navegação, proteção da página, autorização no servidor para cada leitura e escrita, dependência entre permissões pai e filhas, segregação de ações sensíveis e valores padrão para perfis administrativos e restritos.
- Não considere a ocultação de botões como controle de acesso. Toda operação sensível deve validar a permissão correspondente no servidor e permanecer inacessível por chamada direta à API.
- Registre no relatório final quais permissões foram criadas, reutilizadas ou alteradas e se perfis existentes precisam de ajuste manual ou migração.

## Largura e aproveitamento das telas

- Toda página interna deve usar o componente central `PageContainer`. Não crie larguras máximas arbitrárias na raiz de uma tela.
- A variante padrão é `default`, com largura máxima de `1440px`. Ela se aplica a dashboards, integrações, perfis, detalhes operacionais, gestão de pessoas, cards, listas e fluxos por etapas.
- Use `compact`, com largura máxima de `1220px`, em formulários, cadastros, conferências e páginas predominantemente lineares ou de leitura.
- Use `wide`, com largura máxima de `1600px`, em relatórios, escalas e tabelas densas que precisam manter várias colunas simultaneamente visíveis.
- Use `fluid`, sem largura máxima, somente quando a dimensão horizontal fizer parte da funcionalidade da tela. Exemplos permitidos: mapas, organogramas navegáveis, kanbans extensos, calendários operacionais, planilhas, editores com painéis simultâneos e comparações lado a lado.
- `fluid` é excepcional e deve atender a pelo menos um destes critérios: reduzir a largura oculta informação indispensável; exige rolagem horizontal recorrente mesmo em `1600px`; prejudica uma interação espacial como arrastar ou comparar; ou a dimensão horizontal representa dados, tempo, localização ou sequência operacional.
- Não use `fluid` para formulários, perfis, detalhes de integração, listas simples, faixas de status, alertas, grids comuns de indicadores ou páginas com apenas duas ou três colunas.
- Mesmo em páginas `fluid`, cabeçalhos, textos, filtros e mensagens devem manter largura de leitura adequada quando não dependem do espaço horizontal.
- Os contêineres devem permanecer responsivos e centralizados, com margens horizontais de `16px` no celular, `24px` no tablet e `32px` no desktop. As margens pertencem ao shell da página e não devem ser duplicadas pelos filhos.
- `max-w-full` ou `max-w-none` na raiz da página só é permitido por meio da variante `fluid`. Modais e componentes internos seguem dimensões próprias e não definem a largura da página.
