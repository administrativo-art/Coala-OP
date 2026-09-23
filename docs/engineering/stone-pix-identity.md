# Identidade de origem no Pix Stone

Incremento local em `feat/stone-pix-identity`, base `6cad6847`.
Classificação: contrato de integração. Não conclui a conciliação Pix.

## Evidência e decisão

O usuário informou que só existe a chave criada na conta da unidade Tirirical.
Isso não foi interpretado como autorização para consultar outras contas ou como
prova de que todo Pix recebido pertence à unidade.

A [documentação de cliente Stone](https://conciliacao.stone.com.br/reference/overview-da-api-cliente-stone)
confirma a geração no Portal e informa que a chave atende aos StoneCodes do mesmo
CPF/CNPJ. Não foi consultada a credencial nem a conta real.

A [estrutura Pix](https://conciliacao.stone.com.br/reference/estrutura-do-arquivo-pix)
descreve `pix_transaction__additional_data` como StoneCode e serial do terminal.
O [CSV público de exemplo](https://pub-027e93dcf57742efaa5492a7be1efe5e.r2.dev/exemplo-arquivo-conciliacao-pix-stone.csv),
consultado em 2026-09-22, usa a forma abaixo (identificadores substituídos):

```text
[{name=Cliente, value=123456789}, {name=Terminal, value=TEST-001}]
```

Há também linhas com `[]`. O exemplo comprova uma forma observada, não um contrato
de que todas as vendas sempre terão esse campo ou essa sintaxe.

## Implementação e limites

O parser existente descartava a identidade. Agora preserva `merchantIdentity`
versionada com StoneCode e serial somente quando reconhece integralmente a forma
observada. Ausência, formato desconhecido, duplicidade, excesso de tamanho ou
divergência com o serial dedicado resultam em identidade pendente, sem StoneCode.
Não preserva o conteúdo bruto adicional nem dados pessoais de pagadores.

Reutilizado o parser CSV existente, sem novo transporte ou abstração global. O
webhook existente grava os campos normalizados de cada linha; o campo novo passará
a acompanhar futuros processamentos após publicação. Nenhum arquivo histórico foi
reprocessado. Dados antigos sem `merchantIdentity.version` não comprovam identidade.

Identidade de origem não equivale a vínculo autorizado: um leitor futuro deverá
resolver StoneCode → unidade/conta pelo cadastro oficial vigente e validar escopo
do documento/arquivo. Nenhuma unidade é atribuída pelo parser. A API key usada no
XML não substitui a validação do webhook Pix, que tem segredo e documento próprios.

O campo legado `transactionId` ainda representa `id` do CSV (evento); não deve ser
tratado como identidade única de venda. O parser monetário legado continua tolerante
e não serve como validação estrita para conciliar. Antes de ligar Pix à tela, ainda
são necessários contrato monetário estrito, tratamento de eventos/cancelamentos,
leitura limitada e consistente da geração do arquivo e testes do fluxo integrado.
Não somar eventos repetidos como vendas distintas nem confirmar recebimento bancário.

## Verificação e impacto

Dez testes específicos aprovados, incluindo cinco novos testes de identidade,
conflito, ausência, formato desconhecido e não retenção de conteúdo bruto.
Verificação geral registrada no plano ao concluir.
Execução de leitura do parser contra o CSV público: 29 linhas, quatro identidades
reconhecidas e 25 ausentes, sem imprimir dados de pagadores ou identificadores.
Não equivale a validação com transações da unidade. E2E não alterado: mudança isolada
de normalização, sem novo fluxo de usuário; testes de contrato cobrem o incremento.

Sem nova rota, query, listener, polling, permissão ou migração. Preflight incremental:
0 leituras e 0 documentos escritos adicionais por execução; apenas campos pequenos
nos documentos já normalizados pelo webhook. A substituição legada de transações
não foi alterada e precisa de análise de consistência/limites antes do novo leitor.
Nenhuma chamada à conta real, escrita em produção, publicação ou movimentação financeira.
