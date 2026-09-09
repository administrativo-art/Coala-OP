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

## Dados gravados na despesa ou movimentação

Quando há correspondência, o registro recebe os campos `uberTripId`, `uberRequesterName`, `uberRequesterEmail`, `uberEmployeeId`, `uberService`, `uberRequestDateLocal`, `uberTripAmount`, `uberTripCurrency`, `uberReceiptUrl`, `uberMatchedAt` e `uberMatchConfidence`.

As coleções operacionais `uberSftpImports`, `uberTrips` e `uberReconciliations` são usadas apenas pelas funções administrativas. Elas não foram expostas pelas regras do cliente. A interface reutiliza as permissões financeiras existentes para mostrar somente o resumo copiado à despesa.

## Infraestrutura obrigatória

A Uber restringe o SFTP por endereço IP. Uma Cloud Function usa endereços dinâmicos por padrão, portanto o job precisa sair por uma VPC com Cloud NAT e um IP regional estático. O código já exige um conector VPC e configura todo o tráfego de saída do job por ele.

Na região `southamerica-east1`, criar:

- um Serverless VPC Access connector;
- um Cloud Router;
- um endereço IPv4 externo regional reservado;
- um Cloud NAT manual associado ao endereço e à sub-rede do conector.

Registrar o IP reservado em **Configurações > Integrações > SFTP do colaborador > Endereços de IP** da Uber. O IP residencial usado no teste local pode permanecer para acesso manual, mas não é usado pelo Coala One.

Referências oficiais: [saída estática no Cloud Run/Functions](https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip) e [conectores VPC](https://docs.cloud.google.com/run/docs/configuring/vpc-connectors).

## Parâmetros e segredos

Parâmetros solicitados no deploy:

| Nome | Exemplo | Observação |
| --- | --- | --- |
| `UBER_SFTP_ENABLED` | `false` no primeiro deploy | Ativar somente depois do IP ser liberado na Uber. |
| `UBER_SFTP_USERNAME` | identificador exibido como “Conta SFTP” | Não é o e-mail do usuário. |
| `UBER_SFTP_HOST_FINGERPRINT_SHA256` | `SHA256:...` | Confirmar por um canal confiável antes do deploy. |
| `UBER_SFTP_VPC_CONNECTOR` | nome/caminho do conector | Deve estar em `southamerica-east1`. |

Segredos do Secret Manager:

```sh
firebase functions:secrets:set UBER_SFTP_PRIVATE_KEY --data-file "/caminho/seguro/uber_business_sftp"
firebase functions:secrets:set UBER_SFTP_PRIVATE_KEY_PASSPHRASE
```

O segundo comando pede a senha sem gravá-la no repositório. Nunca usar o arquivo `.pub` como `UBER_SFTP_PRIVATE_KEY`: a Uber recebe a chave pública; o Secret Manager recebe a chave privada correspondente. A documentação oficial do Firebase descreve o armazenamento e o vínculo de segredos: [configuração de ambiente e Secret Manager](https://firebase.google.com/docs/functions/config-env).

## Sequência segura de implantação

1. Criar VPC, conector, IP e NAT; anotar o IP reservado.
2. Adicionar o IP à conta SFTP da Uber e aguardar a ativação informada pelo portal.
3. Criar os dois segredos sem copiar seus valores para logs ou tickets.
4. Implantar as três funções com `UBER_SFTP_ENABLED=false`.
5. Confirmar nos logs que os gatilhos de despesas não geram erros.
6. Alterar `UBER_SFTP_ENABLED=true` e reimplantar `uberSftpDailySync`.
7. Após a primeira execução, conferir `uberSftpImports`, a quantidade de viagens e uma amostra de correspondências.

Não há migração obrigatória. Despesas antigas só serão revisitadas se forem regravadas ou se suas chaves de correspondência já tiverem sido geradas pelos gatilhos após o deploy.

## Limites, custo e proteção contra escala

- Não há varredura integral de `expenses`, `transactions` ou `uberTrips`.
- Cada arquivo tem limite de 25 MiB e 100 mil linhas; cada execução processa no máximo dez arquivos.
- Cada busca de viagem lê no máximo 11 documentos. Se houver várias opções, nenhuma é vinculada automaticamente.
- A busca reversa por novas viagens usa lotes de até 30 chaves e no máximo 300 candidatas por tipo; atingir o teto aborta o lote em vez de inferir unicidade com dados incompletos.
- Uma viagem guarda no máximo 50 linhas transacionais, evitando crescimento ilimitado do documento.
- Escritas que não são Uber ainda invocam o gatilho, mas são filtradas em memória antes de qualquer consulta ao Firestore.

Para `N` viagens importadas e `C` gravações candidatas Uber por mês, a base é aproximadamente `N` leituras transacionais + `N` escritas de viagem, somadas às consultas e gravações de reconciliação de `C`. Cada candidata consulta no máximo 11 viagens, mas normalmente retorna zero ou uma. O custo fixo inclui uma invocação por escrita em `expenses` e `transactions`, inclusive para registros não Uber, além do conector VPC, Cloud NAT, IP reservado, Scheduler e Secret Manager. Conferir as tabelas de preço do projeto antes da ativação em produção.

## Operação e rollback

- Desativação imediata: definir `UBER_SFTP_ENABLED=false` e reimplantar o job. Os gatilhos continuam apenas reconhecendo candidatas e não acessam o SFTP.
- Falha de autenticação ou IP: o job registra um `eventId` sem imprimir chave, senha ou conteúdo pessoal do relatório.
- Arquivo parcialmente processado: a execução falha, a importação fica `failed` e pode ser repetida com segurança; as viagens são atualizadas de forma idempotente.
- Correspondência ambígua: o registro permanece sem vínculo automático e exibe aviso para revisão.
- Troca de chave: criar nova versão dos segredos, atualizar a chave pública na Uber e reimplantar a função que referencia os segredos.

## Limitações conhecidas

- A atualização ocorre depois da publicação do relatório diário da Uber, e não no momento da corrida.
- O cruzamento automático exige igualdade do total agregado por viagem. Gorjeta ou ajuste que chegue como uma cobrança separada pode permanecer aguardando.
- Duas viagens com mesmo valor, moeda e janela de datas são tratadas como ambíguas.
- O fluxo atual reconhece viagens; Uber Eats e entregas são excluídos deliberadamente.
