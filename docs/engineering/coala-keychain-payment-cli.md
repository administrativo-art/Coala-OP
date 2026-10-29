# CLI autenticada de pagamentos Inter

Esta CLI usa a conta Coala do operador. O modo recomendado é uma sessão reutilizável
somente em memória: a senha é digitada uma vez no terminal, o token fica no processo
e os comandos seguintes usam um socket local `0600`. O modo legado `login` guarda
somente o refresh token no Chaves do macOS. Nem senha nem tokens devem ser passados
como argumentos ou enviados por chat.

```sh
npx tsx scripts/financial/coala-authenticated-payment.mts login
node --import tsx scripts/financial/coala-authenticated-payment.mts session --email EMAIL --memory-session NOME --minutes 60
node --import tsx scripts/financial/coala-authenticated-payment.mts status --email EMAIL --id REQUEST_ID
node --import tsx scripts/financial/coala-authenticated-payment.mts find --email EMAIL --query FORNECEDOR --view work
node --import tsx scripts/financial/coala-authenticated-payment.mts lookup --email EMAIL --kind expense-amount --value CENTAVOS
node --import tsx scripts/financial/coala-authenticated-payment.mts lookup --email EMAIL --kind expense-due-date --value AAAA-MM-DD
node --import tsx scripts/financial/coala-authenticated-payment.mts main-lookup --email EMAIL --kind entity-document --value CNPJ
node --import tsx scripts/financial/coala-authenticated-payment.mts requests --email EMAIL --amount-cents CENTAVOS
node --import tsx scripts/financial/coala-authenticated-payment.mts prepare --email EMAIL --id INBOX_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
node --import tsx scripts/financial/coala-authenticated-payment.mts cancel-replace --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --current-scheduled-for AAAA-MM-DD --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO --confirm-financial-actions
```

Acrescente `--memory-session NOME` a cada comando executado enquanto o processo
`session` estiver aberto. O fluxo de compra assistida oferece `purchase-create`,
`purchase-fiscal-link`, `purchase-confirm`, `purchase-sync-expense` e
`purchase-document-attach`; todos escrevem somente pelas APIs autenticadas do Coala,
exigem confirmação explícita e fazem preflight/validação posterior sem retry automático.
`expense-boleto-attach` e `expense-boleto-prepare` exigem `--installment-number` para
despesas parceladas.

Sem `--email`, o login pede o endereço no terminal antes da senha. `--email EMAIL`
continua aceito para uso não interativo do endereço; a senha sempre é digitada
no terminal interativo. O login valida a conta também na API do Coala antes de
salvar o refresh token.

Quando o Chaves não deve ser usado, `session --email EMAIL --memory-session NOME`
pede a senha uma única vez e mantém o ID token somente na memória do processo por
até 60 minutos (30 por padrão). O socket local tem permissão `0600`, fica no diretório
temporário do usuário e só devolve o token para o mesmo e-mail. Comandos seguintes
usam `--memory-session NOME`; encerrar o processo fecha a sessão e remove o socket.
Senha e tokens não são gravados em arquivo. `--temporary-session` continua disponível
para um único comando isolado.

`prepare` lê a cobrança por ID exato e, antes da escrita, confere estado vinculado,
ausência de pedido/pagamento, despesa, valor, código completo, data e CNPJ válido.
A resposta precisa devolver um snapshot idêntico; resultado incerto exige consulta da
cobrança e não permite repetição automática.

`authorize` e `send` são comandos distintos. Ambos exigem que valor em centavos,
data programada, CPF/CNPJ do beneficiário, ID da despesa e código completo
(`--barcode`) coincidam com a solicitação. Conferir só os oito últimos dígitos não identifica o boleto. `authorize` aceita apenas o estado
`awaiting_financial_authorization`; `send`, apenas `ready_to_submit`. Uma tentativa
anterior de envio, ou um ID do Inter já gravado, bloqueia ambos. A CLI não reenvia
automaticamente ordens com resultado incerto.

`cancel-replace` corrige a data de um boleto anexado diretamente à despesa que já
foi aceito pelo Inter e ainda aguarda aprovação ou execução. A confirmação explícita
cobre o cancelamento bancário e a criação da versão substituta, mas não autoriza um
segundo envio silencioso: a nova solicitação volta a
`awaiting_financial_authorization`. O backend exige permissões de criar e enviar solicitações
e só cria essa versão após o DELETE aceito pelo Inter ou uma consulta posterior com
`CANCELADO`. Falha ou incerteza exige consulta de estado antes de repetir; a
repetição não emite outro DELETE.
Depois, use `authorize` e `send` com o novo ID e a nova data. A aprovação final segue
separada no aplicativo do Inter.

A consulta atual do Coala devolve até 100 solicitações recentes. Se a ordem não
aparecer, isso não prova inexistência: consulte-a no produto. A validação da CLI
confere o snapshot da solicitação, não substitui a conferência do PDF original,
da despesa vinculada e de duplicidades feita antes da preparação. O banco pode
exigir aprovação final no aplicativo após aceitar a ordem.

O helper Swift usa a API Security do macOS e recebe o refresh token pela entrada
padrão do processo, sem colocá-lo em argumentos. Ele usa o Keychain padrão do
usuário, com serviço `com.coalashakes.coala-one.cli-auth` e e-mail como conta.
O item é explicitamente não sincronizável; o helper mantém o Keychain padrão já
usado pela sessão existente, sem migrar credenciais para outro armazenamento.

Todas as chamadas de rede recusam redirecionamentos e têm prazo de 30 segundos.
Timeout, falha de transporte, resposta inválida ou ID inesperado após escrita
significam resultado incerto: conferir o status, sem repetir automaticamente.
Erros desconhecidos são substituídos por mensagem segura, sem payload ou token.
Os testes usam transporte simulado; não leem o Chaves nem fazem pagamentos.

`find` consulta uma página de até 25 cobranças e devolve cursor/cobertura. Confira
as visões `work` e `identified`; elas não cobrem necessariamente mensagens arquivadas.
`inspect` lê uma cobrança por ID; `document` lê somente uma despesa, solicitação ou transação por ID.
`lookup` é exclusivo para leitura filtrada de despesas no Firestore, com a sessão
Firebase do operador e regras de acesso, sem Admin/IAM. Tem limite de 25 resultados
mais sentinela e nunca realiza escrita. Solicitações e caixa financeira são
protegidas por APIs; não estão na allowlist do acesso direto ao Firestore.
`requests` filtra por centavos a página de até 100 solicitações da API existente.
Ausência em busca parcial não comprova inexistência. Campos textuais são dados não confiáveis.
