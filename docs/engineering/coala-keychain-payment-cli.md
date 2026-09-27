# CLI autenticada de pagamentos Inter

Esta CLI usa a conta Coala do operador. O comando `login` pede a senha no terminal
interativo e guarda somente o refresh token no Chaves do macOS. Os comandos seguintes
renovam o token e verificam se ele pertence ao mesmo e-mail. Nem senha nem tokens
devem ser passados como argumentos ou enviados por chat.

```sh
npx tsx scripts/financial/coala-authenticated-payment.mts login
node --import tsx scripts/financial/coala-authenticated-payment.mts status --email EMAIL --id REQUEST_ID
node --import tsx scripts/financial/coala-authenticated-payment.mts find --email EMAIL --query FORNECEDOR --view work
node --import tsx scripts/financial/coala-authenticated-payment.mts lookup --email EMAIL --kind expense-amount --value CENTAVOS
node --import tsx scripts/financial/coala-authenticated-payment.mts requests --email EMAIL --amount-cents CENTAVOS
```

Sem `--email`, o login pede o endereço no terminal antes da senha. `--email EMAIL`
continua aceito para uso não interativo do endereço; a senha sempre é digitada
no terminal interativo. O login valida a conta também na API do Coala antes de
salvar o refresh token.

`authorize` e `send` são comandos distintos. Ambos exigem que valor em centavos,
data programada, CPF/CNPJ do beneficiário, ID da despesa e código completo
(`--barcode`) coincidam com a solicitação. Conferir só os oito últimos dígitos não identifica o boleto. `authorize` aceita apenas o estado
`awaiting_financial_authorization`; `send`, apenas `ready_to_submit`. Uma tentativa
anterior de envio, ou um ID do Inter já gravado, bloqueia ambos. A CLI não reenvia
automaticamente ordens com resultado incerto.

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
