# Boleto anexado à despesa

O painel Documentos da despesa permite anexar PDF e preparar uma solicitação bancária sem e-mail ou registro fictício na caixa de cobranças. A origem bancária é `expense_boleto`.

## Primeira versão

- Despesa de pagamento único, em aberto, sem pagamento registrado ou vínculo com caixa de cobranças.
- Boleto bancário com linha digitável de47 dígitos, valor nominal e CNPJ do favorecido válidos. Outros formatos continuam no fluxo existente.
- Operador confere PDF, favorecido, competência e vencimento. A validação determinística verifica dígitos, fator de vencimento, valor e correspondência com a despesa; não extrai nem atesta automaticamente o texto do PDF.
- PDF de até10 MB, privado e imutável, identificado por SHA256. A versão anexada não pode ser substituída por outro arquivo neste fluxo.
- Preparação, autorização financeira, envio ao Inter e aprovação final no banco são etapas distintas. O anexo não agenda pagamento. O vencimento não altera a competência.

## API e integridade

`POST /api/financial/expenses/[expenseId]/boleto`: multipart `file`, `barcode`, `amountCents`, `dueDate`, `competenceMonth`, `beneficiaryDocument`, `documentReference`, `confirmed=true`.

`GET` na mesma rota baixa o PDF com sessão autenticada e permissão de visualização. Não há URL pública nem caminho de Storage aceito do cliente.

`POST .../boleto/payment`: JSON `{ scheduledFor: "YYYY-MM-DD", confirmed: true }`. Retorna a solicitação; a autorização e o envio usam as rotas já existentes.

Dados canônicos do arquivo ficam em `expenseBoletoAttachments/{expenseId}`, sem leitura/escrita direta por cliente. A despesa recebe apenas um espelho para exibição. O upload usa chave content-addressed e precondição de não sobrescrita. Arquivo e banco não formam transação distribuída: o arquivo é persistido primeiro; uma disputa pode deixar objeto privado sem vínculo, recuperável pela mesma chave em nova tentativa.

Vínculo, metadados e auditoria são transacionais. Preparação usa ID determinístico por despesa, consulta limitada por código/hash e trava a despesa. O envio revalida a fonte e impede repetição após tentativa anterior; resultados incertos exigem revisão. O serviço Inter mantém sua consulta bancária de duplicidades.

A nova origem participa dos débitos esperados, observação bancária, conciliação pelo extrato e comprovantes. Não cria mensagem inbox nem usa a baixa Pix. Nenhum status de envio significa pago.

## Permissões e custo

Reutilizadas: financeiro/view, despesas/view/edit, solicitações/view/create/authorize/submit. O servidor verifica as permissões; esconder botões não é controle de acesso. Não é necessária migração de perfis. A coleção canônica permanece negada pelas regras existentes por ausência de match permitido.

Consultas pontuais por ID e duas consultas exatas limit1 por preparação; nenhum listener, cron ou polling novo. Os jobs existentes mantêm frequência e limites.

## Verificação

`npm run check`, `npm run build` e `npm run test:e2e:expense-boleto`. O último executa a aplicação Next por HTTP com Auth/Firestore/Storage em emuladores `demo-coala-boleto`, sem navegador, credenciais reais ou chamada ao Inter. O teste cobre upload/download, duas preparações simultâneas, idempotência, competência e negação de acesso. Gate financeiro observado separadamente; não executa transferências reais.
