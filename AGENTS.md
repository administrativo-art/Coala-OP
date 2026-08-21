# Regras operacionais do Coala One

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
