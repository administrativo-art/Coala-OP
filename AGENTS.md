# Regras operacionais do Coala One

## CLI e navegador

- Para operações determinísticas, estruturadas ou repetitivas, prefira CLI ou script à automação do navegador.
- Antes de qualquer escrita, o script deve validar os dados e consultar duplicidades. Sempre que possível, deve ser idempotente e oferecer uma etapa de preflight/dry-run.
- O navegador é bloqueado por padrão para as IAs deste projeto. A IA só pode acessá-lo quando o desenvolvedor autorizar expressamente e o acesso for realmente necessário, ou quando o próprio desenvolvedor solicitar o uso do navegador, ainda que exista alternativa por CLI/API.
- A autorização vale apenas para a tarefa em que foi concedida e não deve ser presumida em tarefas seguintes.
- Não repita no navegador uma alteração que o script já confirmou. Quando o uso tiver sido autorizado, limite-o ao escopo solicitado e confira somente os dados necessários, como descrição, valor, competência, vencimento, unidade/centro de resultado, plano de contas e status.
- Se a autenticação da CLI depender de senha, código ou confirmação pessoal, pause e peça ao usuário para concluir a autenticação; nunca solicite nem manipule senhas no chat.

## Limpeza de scripts operacionais

- Todo script temporário ou de execução única deve ser removido ao final do trabalho, depois da execução e da validação do resultado.
- Antes de encerrar, remova também comandos temporários do `package.json` e arquivos auxiliares criados apenas para diagnóstico, preflight, migração pontual ou conferência.
- Rotinas realmente reutilizáveis do produto podem permanecer, desde que estejam nomeadas sem referência a uma ocorrência pontual, sejam idempotentes, tenham validação/preflight e estejam documentadas ou cobertas por testes.
- Nunca remova em massa arquivos antigos ou scripts de outra tarefa sem confirmar que são temporários e que não possuem uso pendente.

## Pagamentos bancários

- Agendar ou preparar um pagamento não autoriza sua execução.
- Nunca autorize, aprove ou confirme definitivamente um pagamento bancário sem uma solicitação específica e inequívoca do usuário para essa ação.
- No Banco Inter, a autorização final pertence ao usuário no aplicativo, salvo se ele der uma nova instrução explícita em sentido diferente.
