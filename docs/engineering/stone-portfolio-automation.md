# Carteira de recebíveis Stone — atualização automática

A fonte da carteira é o extrato diário XML 2.2 da API de conciliação Stone. O
Coala lê capturas e pagamentos pelo par `AcquirerTransactionKey` / número da
parcela, guarda cada arquivo diário uma vez e reconstrói as parcelas abertas.
Uma Function agendada aciona a sincronização às 06:00 em `America/Sao_Paulo`,
depois do horário de publicação informado pela Stone (05:00 do dia seguinte).
A tela lê somente o snapshot pronto; abrir a página não chama a Stone e não
depende de upload de CSV.

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

O XML e o snapshot são limitados a 800 kB por documento. O limite de 731 dias
exige compactação/avanço automático do marco histórico antes de setembro de
2028; o processamento falha de forma visível se a cobertura não puder ser
garantida. O limite também impede que uma conta grande seja exibida como
completa após truncamento. A evolução para múltiplos StoneCodes deve revisar
esses limites e o custo antes de habilitar novas fontes.
