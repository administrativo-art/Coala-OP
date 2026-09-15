# Conciliação de vendas Stone — implementação e rollout

Status: implementação local em andamento, sem publicação e sem acesso ao provedor.

Este documento operacionaliza o plano-mestre
[`plano-integracao-stone-conciliacao.md`](./plano-integracao-stone-conciliacao.md).
Ele registra os limites já implementados e os gates que precisam ser satisfeitos
antes de habilitar a conciliação em produção.

## Contrato implementado nesta etapa

- Fatos canônicos de pagamentos PDV e vendas Stone usam centavos inteiros,
  `America/Belem`, IDs determinísticos e eventos por revisão da fonte.
- Um lote aceita no máximo 200 linhas. Lotes grandes devem ser enviados em
  fragmentos com `finalize=false`; somente o último fragmento usa
  `finalize=true` para reconstruir e ativar a projeção mensal.
- A reimportação com a mesma chave de idempotência devolve o resultado anterior.
- Uma nova execução pode atualizar a projeção corrente do fato, mas não altera o
  conteúdo do evento identificado pelo hash daquela revisão.
- A projeção nova só se torna ativa depois que os casos e resumos foram gravados.
  Uma execução concorrente mais nova impede a ativação da anterior.
- Decisões humanas são associadas à identidade estável do caso. Elas só são
  reaplicadas quando o hash das fontes continua igual; revisão posterior deixa a
  decisão anterior supersedida e o caso volta ao estado sugerido pelo motor.
- Acesso direto pelo cliente às novas coleções é negado. Leituras e escritas
  passam pelas rotas autenticadas e permissões específicas.

## Limites e estimativa de custo por operação

Os números abaixo são tetos do código, não previsão de volume real:

| Operação | Leituras máximas | Escritas máximas aproximadas |
|---|---:|---:|
| Importar fragmento sem finalizar | transação pontual do `run` e até 101 mapeamentos se necessários | 2 por fato + atualizações do `run` |
| Finalizar uma competência | 5.001 fatos PDV + 5.001 vendas Stone + até 10.000 decisões + resumos existentes das unidades | até 10.000 casos + 2 resumos por unidade + controle e `run` |
| Listar casos sem unidade | 1 controle + até 101 casos + até 21 períodos + até 20 resumos de caixa | 0 |
| Listar casos de uma unidade | 1 controle + até 101 casos + 1 período + 1 resumo de caixa | 0 |
| Listar diferenças de caixa de uma unidade/mês | até 32 fechamentos + 31 decisões | 0 |
| Classificar diferença de caixa | até 4 leituras transacionais | até 4 escritas atômicas (decisão, evento e efeitos aplicáveis) |
| Listar recebíveis Stone | até 101 recebíveis por página | 0 |
| Listar liquidações Stone | até 101 liquidações por página | 0 |
| Vincular/desvincular liquidação ao extrato | 2 leituras transacionais | até 3 escritas atômicas, incluindo evento |
| Abrir administração da integração | até 101 mapeamentos + 51 execuções | 0 |
| Criar/editar mapeamento | até 103 leituras (unidade, conta e mapeamentos) | 2 escritas atômicas, incluindo evento |
| Confirmar saldo de uma conta | 2 leituras transacionais | 2 escritas atômicas, incluindo evento |
| Listar saldos confirmados | até 51 leituras | 0 |
| Compor fluxo de caixa de 91 dias | até 26.107 leituras no teto defensivo | 0 |

Uma leitura que ultrapasse o teto é recusada; não ocorre scan completo como
fallback. A tela deverá paginar por cursor e não usará listener ou polling. Os
índices versionados correspondem somente às consultas documentadas.

O limite de 10.000 decisões representa o pior caso teórico de 5.000 registros
em cada fonte sem correspondência. O spike com dados reais é gate de rollout:
ele deve medir transações/dia, propor um limite por unidade/dia se necessário e
estimar leituras, escritas, armazenamento e chamadas mensais. Sem esse volume,
qualquer estimativa monetária seria fictícia.

A composição de caixa é acionada somente ao abrir ou alterar os filtros da tela,
sem polling ou listener. Seu teto defensivo soma 51 contas, 51 saldos confirmados, 5.001 recebíveis,
5.001 despesas datadas, 501 sem data, 5.001 solicitações, 5.001 transações e até
5.500 obrigações referenciadas. Esse teto serve para interromper volumes
inesperados, não como meta operacional. No cenário extremo de uma abertura por
hora, três usuários e oito horas em 22 dias, seriam até 13.757.568 leituras por
mês no teto anterior; com a coleção protegida de saldos, o teto atualizado é de
13.784.496 leituras mensais. O spike deverá medir o volume real; se uma carga típica se aproximar desses
limites, resumos diários reconstruíveis de no máximo 91 documentos por escopo
passam a ser gate obrigatório antes do rollout. Cada resposta informa as
contagens reais por fonte para acompanhamento pós-ativação.

## Ordem segura de ativação

1. Obter contrato/credenciais Stone e executar o spike somente leitura descrito
   no plano-mestre, guardando payload bruto apenas em diretório temporário.
2. Gerar fixtures anônimas e validar status, IDs, paginação, cancelamentos,
   antecipações, recebíveis, liquidações e conta Stone.
3. Publicar regras e índices antes das rotas e aguardar todos os índices ficarem
   prontos.
4. Migrar permissões de perfis em dry-run e revisar o relatório antes da escrita.
5. Rodar o backfill em dry-run a partir de agosto de 2026, primeiro no Tirirical.
6. Importar em modo sombra, comparar totais e classificar todas as exceções de
   dez dias consecutivos.
7. Repetir para João Paulo e Shopping do Automóvel. O possível alias “Whopping”
   não cria unidade nem chave nova sem decisão explícita do negócio.
8. Só depois habilitar o critério “Receita conciliada” na DRE; o critério PDV
   continua sendo o padrão inicial.

## Gates que continuam externos

- confirmação do contrato de API/arquivo e do escopo real dos Stonecodes;
- credenciais, homologação, rate limits, cursores e política de webhooks;
- saldo bancário confirmado e política de transferência Stone para o Inter;
- amostras reais anonimizadas para validar o custo e os campos disponíveis;
- aprovação do Financeiro para fechar o primeiro período e promover a DRE.

Nenhuma etapa deste rollout autoriza antecipação, transferência, pagamento,
alteração no PDV ou outra movimentação bancária automática.
