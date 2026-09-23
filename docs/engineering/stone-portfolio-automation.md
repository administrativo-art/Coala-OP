# Carteira de recebíveis Stone — atualização automática

A fonte da carteira é o extrato diário XML 2.2 da API de conciliação Stone. O
Coala lê capturas e pagamentos pelo par `AcquirerTransactionKey` / número da
parcela, guarda cada arquivo diário uma vez e reconstrói as parcelas abertas.
Uma Function agendada aciona a sincronização às 06:00 em `America/Sao_Paulo`,
depois do horário de publicação informado pela Stone (05:00 do dia seguinte).
A tela lê somente o snapshot pronto; abrir a página não chama a Stone e não
depende de upload de CSV.

O mesmo job lê também a posição diária do layout XML2_4, uma vez por data, e
mostra separadamente os saldos que a Stone classifica como carteira normal,
garantia, cessão ou antecipação Stone. Esta segunda leitura usa a chave de
conciliação já configurada, valida StoneCode/data/layout e guarda somente os
campos allowlisted da posição, sem XML bruto nem dados bancários. Se a leitura
2.4 falhar, a publicação do novo snapshot falha e a posição anterior permanece
visível como atrasada; uma ausência da seção é exibida como ausência, nunca zero.

## Escopo e inicialização

`stonePortfolioSources/{sha256(workspaceId:stoneCode)}` no banco
`coala-financeiro` configura o StoneCode, unidade, conta, vínculo oficial e
`firstCaptureDate`. A configuração inicial do Tirirical usa o vínculo
`tirirical-stone-113654392-20260920`, StoneCode `113654392` e início
`2026-09-01`, data mais antiga das parcelas abertas no relatório Stone
exportado em 23/09/2026. O CSV é evidência de inicialização e conferência;
não é armazenado pelo Coala nem exigido nas atualizações.

O endpoint de leitura é restrito ao administrador padrão e revalida o vínculo
oficial na data atual. A sincronização agendada exige um segredo próprio,
independente da chave de API da Stone, que permanece apenas no servidor. O
Firestore não permite acesso direto do navegador às novas coleções. Não há
escrita em lançamentos de caixa ou baixa bancária.

O resultado cobre vendas capturadas pela Stone desde o início configurado até
o último arquivo publicado. Eventos ambíguos, capturas sem parcelas ou lacunas
impedem publicar um total líquido como confirmado. O snapshot expõe a data de
referência e sinaliza atraso. Não representa saldo bancário, disponibilidade
para antecipação nem posição da registradora; cartões VAN/Voucher fora do
extrato Stone também não entram.

A posição 2.4 é um saldo agregado por arranjo, natureza e categoria, sem chave
que ligue contratos a cada parcela da lista de recebimentos. Portanto, as
parcelas seguem sem estado individual de "livre", "cedida" ou "em garantia".
Não se subtrai uma natureza da outra nem se publica um total disponível. A
[documentação da Stone sobre Registradora](https://conciliacao.stone.com.br/docs/registradora)
descreve arquivos complementares de negociação e RAV, mas não documenta ali
endpoint, autenticação, layout ou chave de vinculação à parcela. A integração
individual precisa desses contratos e de acesso habilitado para o StoneCode;
nenhum endpoint é presumido nem é usada a chave de conciliação fora do contrato
documentado. A leitura agregada já fica automática enquanto essa dependência
externa é resolvida.

Para concluir o estado **por parcela**, solicitar à Stone o contrato atual dos
arquivos complementares Registradora e RAV para a própria conta: forma de acesso
e habilitação; endpoint ou entrega, autenticação, layout e horário de publicação;
chaves de Unidade de Recebíveis e de ligação com Stone ID, parcela, arranjo e
vencimento; tratamento de negociação, baixa, alteração, estorno e versões do
mesmo direito. Pedir exemplos de garantia, cessão a terceiros e antecipação
Stone. A regra de aceite é reconciliar cada direito com a agenda e com os
saldos por natureza do 2.4 sem dupla contagem; qualquer linha não vinculada
continua explicitamente não confirmada.

## Conferência inicial

O CSV exportado em 23/09/2026 tem 112 parcelas abertas, líquido exato de
R$ 1.366,802300. Dessas, 109 foram vendidas até 22/09; outras três foram
vendidas em 23/09. Onze parcelas vendidas até 22/09 aparecem pagas em 23/09.
Portanto, a reconstrução **até 22/09** deve trazer 120 parcelas ainda abertas
naquela data (109 atualmente abertas + 11 pagas no dia seguinte). A comparação
deve usar chave, datas e valores por parcela; um total de 112 contra o arquivo
de 22/09 seria uma comparação de instantes diferentes. O arquivo de 23/09 só
é publicado pela Stone em 24/09 após 05:00, quando a posição poderá ser
comparada diretamente às 112 linhas abertas do CSV, ressalvadas movimentações
posteriores à exportação.

## Custo e limites

O job lê até 21 documentos de configuração por execução. Para o Tirirical,
o primeiro processamento lê cerca de 22 documentos de cache e grava um por
dia; após a inicialização, há uma requisição à Stone por data nova e uma
escrita de snapshot por dia. A reconstrução relê os dias em cache uma vez por
execução, limitada a 731 documentos/dia: no primeiro mês, cerca de 700 a
1.600 leituras/mês; no limite, 22 mil leituras/mês por StoneCode. A página
faz uma leitura do snapshot por abertura/troca de vínculo, sem polling.

A posição 2.4 acrescenta uma chamada Stone, uma leitura de cache e até uma
escrita por data nova e StoneCode: no Tirirical, cerca de 30 chamadas, 30
leituras e 30 escritas mensais após inicialização. A página continua lendo o
mesmo documento de snapshot, sem chamada adicional à Stone. As permissões
administrativas e as regras de acesso ao Firestore não mudam.
A [Stone limita a cinco consultas por StoneCode/data em uma hora](https://conciliacao.stone.com.br/reference/rate-limit):
o primeiro job usa uma chamada XML2_2 e uma XML2_4 para a data nova; execuções
seguintes usam o cache. A consulta manual histórica 2.4 continua separada e
também consome essa franquia quando usada.

O XML e o snapshot são limitados a 800 kB por documento. O limite de 731 dias
exige compactação/avanço automático do marco histórico antes de setembro de
2028; o processamento falha de forma visível se a cobertura não puder ser
garantida. O limite também impede que uma conta grande seja exibida como
completa após truncamento. A evolução para múltiplos StoneCodes deve revisar
esses limites e o custo antes de habilitar novas fontes.
