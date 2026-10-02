# Integração Uber SFTP no Coala One

## Objetivo

Importar automaticamente os relatórios diários de viagens da conta Uber for Business e enriquecer despesas e movimentações reconhecidas como Uber com solicitante, serviço, data, identificador e valor da viagem.

O processamento roda nas Cloud Functions do Coala One. O computador usado para gerar a chave SSH não participa da operação após a implantação.

## Fluxo

1. `uberSftpDailySync` conecta a `sftp.uber.com:2222` todos os dias às 12h30 em `America/Belem`.
2. O job lê até dez arquivos `daily_trips-AAAA-MM-DD.csv` dos últimos 35 dias em `/from_uber/trips`.
3. Cada versão remota é reivindicada em `uberSftpImports`, impedindo processamento simultâneo ou repetido.
4. Linhas de viagens são agregadas por viagem e moeda e gravadas em `uberTrips`. Registros de Uber Eats ou entrega são descartados.
5. Escritas em `expenses` e `transactions` são examinadas por gatilhos. Uma saída com fornecedor ou descrição Uber torna-se candidata.
6. O cruzamento exige o mesmo valor total e moeda e aceita diferença de até três dias entre a movimentação e a solicitação da viagem.
7. Uma única candidata é vinculada automaticamente. Zero candidatas deixa o registro aguardando; mais de uma deixa o registro ambíguo e não vincula nada.
8. O resultado e o motivo são registrados em `uberReconciliations` na mesma transação que atualiza a despesa/movimentação.

O SFTP é uma entrega diária de arquivos, não uma API em tempo real. Por isso, uma despesa pode aparecer primeiro como “Uber identificada; aguardando o relatório diário” e ser completada depois.

O importador localiza o cabeçalho após eventuais linhas de metadados e aceita
CSV com vírgula ou ponto e vírgula. Se faltar uma coluna essencial ou houver
linhas de corrida sem valor/data legíveis, o arquivo falha com um código estável,
sem gravar uma importação vazia como concluída. Erros não registram o conteúdo
do CSV nos logs. A versão do parser é gravada em `uberSftpImports`: arquivos
concluídos por uma versão anterior são processados novamente uma vez, com
deduplicação das transações por impressão digital.

## Dados gravados na despesa ou movimentação

Quando há correspondência, o registro recebe os campos `uberTripId`, `uberRequesterName`, `uberRequesterEmail`, `uberEmployeeId`, `uberService`, `uberRequestDateLocal`, `uberTripAmount`, `uberTripCurrency`, `uberReceiptUrl`, `uberMatchedAt` e `uberMatchConfidence`.

As coleções operacionais `uberSftpImports`, `uberTrips` e `uberReconciliations` são usadas apenas pelas funções administrativas. Elas não foram expostas pelas regras do cliente. A interface reutiliza as permissões financeiras existentes para mostrar somente o resumo copiado à despesa.

## Infraestrutura obrigatória

A Uber restringe o SFTP por endereço IP. Uma Cloud Function usa endereços dinâmicos por padrão, portanto o job precisa sair por uma VPC com Cloud NAT e um IP regional estático. O código de `uberSftpDailySync` usa **Direct VPC egress** como configuração-alvo, evitando manter máquinas de um Serverless VPC Access connector permanentemente ligadas. Os PRs #267 e #268 integraram e promoveram esse código, mas a verificação somente leitura de 02/10/2026 ainda encontrou a função em `ACTIVE` com `coala-uber-sftp` e `ALL_TRAFFIC`, sem interface Direct VPC. A publicação do código não comprova a migração da rede.

No projeto `smart-converter-752gf`, região `southamerica-east1`, o contrato de produção é:

- rede e sub-rede com faixa `/26` ou maior, configuradas diretamente na função;
- Cloud Router `coala-uber-egress-router` na mesma VPC da sub-rede;
- Cloud NAT `coala-uber-egress-nat`, cobrindo a sub-rede da função;
- endereço IPv4 regional reservado `coala-uber-egress-ip` (`34.151.241.62`) como único IP do NAT com alocação `MANUAL_ONLY`;
- egress `VPC_EGRESS_ALL_TRAFFIC` na função.

O IP reservado precisa permanecer em **Configurações > Integrações > SFTP do colaborador > Endereços de IP** da Uber. A migração de conector para Direct VPC não muda esse endereço. O IP residencial usado no teste local pode permanecer para acesso manual, mas não é usado pelo Coala One.

O SDK `firebase-functions` usado pelo projeto ainda não declara Direct VPC egress. Por isso, a configuração de rede é aplicada de forma restrita pela Cloud Functions v2 API com `npm run uber-sftp:network -- apply`. A opção `preserveExternalChanges: true` existe somente em `uberSftpDailySync` para impedir que um deploy Firebase apague essa configuração externa. Depois de qualquer deploy dessa função, executar `npm run uber-sftp:network -- verify`.

Referências oficiais: [Direct VPC em funções de segunda geração](https://docs.cloud.google.com/functions/docs/running/direct-vpc), [saída estática com Cloud NAT](https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip) e [comparação com conectores](https://docs.cloud.google.com/run/docs/configuring/connecting-vpc).

## Parâmetros e segredos

Parâmetros solicitados no deploy:

| Nome | Exemplo | Observação |
| --- | --- | --- |
| `UBER_SFTP_ENABLED` | `false` no primeiro deploy | Ativar somente depois do IP ser liberado na Uber. |
| `UBER_SFTP_USERNAME` | identificador exibido como “Conta SFTP” | Não é o e-mail do usuário. |
| `UBER_SFTP_HOST_FINGERPRINT_SHA256` | `SHA256:...` | Confirmar por um canal confiável antes do deploy. |

Segredos do Secret Manager:

```sh
firebase functions:secrets:set UBER_SFTP_PRIVATE_KEY --data-file "/caminho/seguro/uber_business_sftp"
```

Use uma chave de serviço exclusiva, sem senha, mantida apenas no Secret Manager. Nunca usar o arquivo `.pub` como `UBER_SFTP_PRIVATE_KEY`: a Uber recebe a chave pública; o Secret Manager recebe a chave privada correspondente. A documentação oficial do Firebase descreve o armazenamento e o vínculo de segredos: [configuração de ambiente e Secret Manager](https://firebase.google.com/docs/functions/config-env).

## Sequência segura de implantação

Para uma instalação nova:

1. Criar a rede/sub-rede, o IP regional, o Router e o NAT; anotar o IP reservado.
2. Adicionar o IP à conta SFTP da Uber e aguardar a ativação informada pelo portal.
3. Criar o segredo sem copiar seu valor para logs ou tickets.
4. Implantar as três funções com `UBER_SFTP_ENABLED=false`.
5. Aplicar Direct VPC egress com `npm run uber-sftp:network -- apply --subnet <sub-rede>`.
6. Confirmar a configuração com `npm run uber-sftp:network -- verify --subnet <sub-rede>`.
7. Alterar `UBER_SFTP_ENABLED=true`, reimplantar `uberSftpDailySync` e repetir a verificação de rede.
8. Executar o Scheduler uma vez e conferir o término nos logs, uma nova tentativa em `uberSftpImports` e fluxos NAT saindo pelo IP reservado.

Para migrar uma função que usa conector:

1. Executar `preflight` e confirmar sub-rede `/26` ou maior, Router na mesma VPC, NAT com único IP manual `34.151.241.62`, função `ACTIVE` e Scheduler `ENABLED` apontando por POST para a URL oficial da função com audience correspondente.
2. Implantar a versão do código com `preserveExternalChanges` e a tolerância de conexão descrita abaixo.
3. Executar `apply`; o script limpa o conector e configura Direct VPC numa única atualização limitada aos quatro campos de rede.
4. Executar `verify`, disparar o Scheduler e validar a sincronização real. A verificação confirma o IP configurado no NAT, não mede o IP público usado por uma conexão. Conferir a tradução nos logs do Cloud NAT e uma nova importação concluída com viagens e linhas; uma execução que apenas pula arquivos antigos não comprova a migração.
5. Manter `coala-uber-sftp` durante a janela de validação. Excluir o conector somente depois de uma execução concluída e da confirmação do IP efetivo no NAT. Após a exclusão, recriar o conector é pré-requisito para o rollback por script.

Na versão da CLI fixada no lockfile, `firebase-tools@15.15.0` usa `minimatch@3.1.5` e `brace-expansion@1.1.21` na dependência legada. O override global de `minimatch@10.2.4` entregava um objeto para `firebase-tools/lib/fsAsync.js`, que chama `minimatch(...)`, e interrompia o deploy antes do upload com `TypeError: minimatch is not a function`. O override qualificado no `package.json` preserva `glob@10` com a API moderna. O teste unitário permanente cobre os dois contratos; isso ainda não comprova o deploy.

Na correção do parser de setembro de 2026, a verificação anterior à implantação
encontrou `uberTrips` vazio: dois arquivos foram marcados como concluídos com
zero viagens e dois falharam na leitura do CSV. Após publicar a correção, conferir
que os arquivos antigos foram reprocessados, que `uberTrips` recebeu corridas e
que novas falhas mostram apenas códigos de erro. Não considerar o deploy validado
somente porque a função está `ACTIVE` ou o agendamento executou.

Não há migração obrigatória. Despesas antigas só serão revisitadas se forem regravadas ou se suas chaves de correspondência já tiverem sido geradas pelos gatilhos após o deploy.

## Limites, custo e proteção contra escala

- Não há varredura integral de `expenses`, `transactions` ou `uberTrips`.
- Cada arquivo tem limite de 25 MiB e 100 mil linhas; cada execução processa no máximo dez arquivos. A seleção examina todos os arquivos da janela de 35 dias e só aplica o limite depois de pular os já concluídos, para não deixar relatórios antigos sem reprocessamento.
- Cada busca de viagem lê no máximo 11 documentos. Se houver várias opções, nenhuma é vinculada automaticamente.
- A busca reversa por novas viagens usa lotes de até 30 chaves e no máximo 300 candidatas por tipo; atingir o teto aborta o lote em vez de inferir unicidade com dados incompletos.
- Uma viagem guarda no máximo 50 linhas transacionais, evitando crescimento ilimitado do documento.
- Escritas que não são Uber ainda invocam o gatilho, mas são filtradas em memória antes de qualquer consulta ao Firestore.
- Direct VPC pode levar mais de um minuto para estabelecer conectividade em uma nova instância. A conexão SFTP espera até 90 segundos e repete até três vezes, com esperas de 5 e 15 segundos. Erros de autenticação, chave privada e impressão digital não são repetidos. O timeout total da função continua em 540 segundos.

Para `N` viagens importadas e `C` gravações candidatas Uber por mês, a base é aproximadamente `N` leituras transacionais + `N` escritas de viagem, somadas às consultas e gravações de reconciliação de `C`. Cada candidata consulta no máximo 11 viagens, mas normalmente retorna zero ou uma. Com um arquivo por dia e uma execução diária, a checagem de arquivos concluídos faz até cerca de 36 leituras por dia (1.080 por mês); execuções manuais e retries somam leituras proporcionais. O custo fixo inclui uma invocação por escrita em `expenses` e `transactions`, inclusive para registros não Uber, além de Cloud NAT, IP reservado, Scheduler e Secret Manager. Direct VPC escala a zero e remove as duas `e2-micro` e os discos mantidos pelo conector. Conferir as tabelas de preço do projeto antes da ativação em produção.

## Custo do NAT e decisões de otimização

A revisão de 02/10/2026 encontrou um único NAT no Router da Uber, com IP manual `34.151.241.62` em uso. Seus mapeamentos mostravam somente as duas instâncias gerenciadas do conector, em `10.8.0.2` e `10.8.0.3`. Entre as quatro Functions e os cinco serviços Cloud Run consultados em `southamerica-east1`, somente o job Uber e seu serviço correspondente tinham configuração VPC. As consultas enumeraram metadados de rede, sem ler segredos ou dados de viagens; repetir o inventário antes de excluir o conector.

O CSV de faturamento de setembro/2026 separa os componentes do NAT: IP, R$ 15,083690; tempo de uso do gateway, R$ 8,445911; processamento, R$ 0,000222; telemetria, R$ 0,000216. Preservar o IP exigido pela Uber e os logs de validação. Medir o gateway novamente após a migração; não somar duas vezes a possível redução associada à retirada das instâncias do conector.

A [cobrança oficial do NAT](https://cloud.google.com/nat/pricing) distingue IP por hora, gateway e processamento de dados. Não prometer custo zero: a função continua usando NAT, o IP externo permanece reservado e os endereços usados pelo conector podem permanecer ativos temporariamente após escala a zero. Setembro também não representa um mês completo de operação desses recursos; comparar períodos de duração equivalente após a publicação.

Não foi identificada alteração adicional de NAT com ganho material comprovado. Durante a validação, preservar Router, NAT, IP, cobertura e logs. Não desligar/recriar o gateway por cron nem reduzir a cobertura de sub-redes: isso acrescenta risco operacional sem economia comprovada neste inventário. As [interações oficiais de Direct VPC com NAT](https://docs.cloud.google.com/nat/docs/nat-product-interactions) exigem `ENDPOINT_TYPE_VM` e cobertura da sub-rede, já observados. Os logs NAT de Direct VPC não identificam o serviço Cloud Run; correlacionar horário, origem da sub-rede, destino/porta SFTP e IP traduzido.

Depois do deploy da função, executar `preflight`, `apply` e `verify`; disparar o Scheduler e confirmar uma importação concluída com viagens/linhas, além da saída pelo IP reservado nos logs do NAT. Manter o conector para rollback até essas evidências existirem. Excluir o conector só após validação; somente a fatura posterior comprova economia realizada.

## Operação e rollback

- Desativação imediata: definir `UBER_SFTP_ENABLED=false` e reimplantar o job. Os gatilhos continuam apenas reconhecendo candidatas e não acessam o SFTP.
- Verificação de rede: `npm run uber-sftp:network -- verify` não lê segredos e falha se função, sub-rede, Router, NAT, IP configurado ou destino do Scheduler divergirem do contrato acima. `configuredNatIp` não é medição de tráfego.
- Rollback de rede: enquanto `coala-uber-sftp` existir e estiver `READY`, executar `npm run uber-sftp:network -- rollback`. Antes do PATCH, o script exige função `ACTIVE` em estado de rede reconhecido. Ele restaura o conector com `ALL_TRAFFIC` e limpa Direct VPC numa atualização atômica. Validar a função e disparar o Scheduler antes de investigar ou excluir a sub-rede direta.
- Falha de autenticação ou IP: o job registra um `eventId` sem imprimir chave, senha ou conteúdo pessoal do relatório.
- Arquivo parcialmente processado: a execução falha, a importação fica `failed` e pode ser repetida com segurança; as viagens são atualizadas de forma idempotente.
- Correspondência ambígua: o registro permanece sem vínculo automático e exibe aviso para revisão.
- Troca de chave: criar nova versão dos segredos, atualizar a chave pública na Uber e reimplantar a função que referencia os segredos.

## Limitações conhecidas

- A atualização ocorre depois da publicação do relatório diário da Uber, e não no momento da corrida.
- O cruzamento automático exige igualdade do total agregado por viagem. Gorjeta ou ajuste que chegue como uma cobrança separada pode permanecer aguardando.
- Duas viagens com mesmo valor, moeda e janela de datas são tratadas como ambíguas.
- O fluxo atual reconhece viagens; Uber Eats e entregas são excluídos deliberadamente.
