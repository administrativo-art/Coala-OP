# Homologação do REP-P

Pacote para levar o REP-P do estado "publicado e bloqueado" à liberação de `REP_P_MARKING_ENABLED`. A coleta oficial permanece bloqueada. `REP_P_PILOT_ENABLED` pode sustentar ensaios nominais segregados, sem NSR, ARP, AFD, AEJ ou fechamento. Estado em 24/10/2026.

## Relatório de gates

| # | Gate | Estado | Evidência / próximo passo |
| --- | --- | --- | --- |
| 1 | Hora Legal (ON, UDP/123) com quórum e desvio ≤ 30 s | Atendido em produção | `clockState: ok` em 18/10/2026 ([guia do fluxo](../../engineering/flows/dp-time-recording.md)); falta simular perda/retomada publicada |
| 2 | Backup, PITR e proteção contra exclusão do `coala-rh` | Atendido para backup/restauração | PITR e proteção ativos, backup diário com retenção de 98 dias; restauração real em banco descartável concluída em 24/10/2026, com contagens idênticas e remoção do destino de ensaio ([evidência](iam-e-restauracao.md#ensaio-executado-em-24102026)) |
| 3 | e-CNPJ A1 da desenvolvedora no Secret Manager | Atendido | `REP_P_ICP_SIGNER_PEM` v1, válido até 16/06/2027; vencimento monitorado pela central de avisos |
| 4 | Amostras AFD/CAdES e comprovante/PAdES aprovadas no ITI | Validação local atendida; ITI pendente | Amostras reais geradas em 24/10/2026; CAdES e PAdES passaram no verificador interno, o CMS passou no OpenSSL e o certificado da CT Sorvetes (CNPJ `14.276.603/0001-25`) encadeou até ICP-Brasil v5. Falta submeter os arquivos ao VALIDAR/ITI ([checklist](validacao-iti.md)) |
| 5 | e-CPF A1 do responsável técnico (e do responsável legal, se for outra pessoa) | Instalado localmente; validação pendente | O e-CPF informado pelo programador foi instalado em 21/10/2026. Falta assinar uma amostra e validar a cadeia/qualificação no ITI. Fica com cada pessoa; **não** vai ao sistema nem ao Secret Manager ([roteiro](#assinatura-com-e-cpf)) |
| 6 | Atestado Técnico e Termo de Responsabilidade do REP-P | Pendente | [Modelo preenchível](atestados.md#rep-p); depende do INPI (gate 8) |
| 7 | Atestado do PTRP | Pendente | Tratamentos, fechamento, espelho, AEJ e banco existem; falta fechar a versão candidata, validar o conjunto integrado e preencher/assinar o atestado correspondente |
| 8 | Registro do programa no INPI | Pendente, pacote técnico preparado | O [checklist do INPI](inpi.md) e o gerador reproduzível de ZIP/hash estão prontos. Faltam autores/titularidade, datas, requerente/signatário e a versão final; o número definitivo configura comprovante e AFD (13 dígitos, P&R 49) |
| 9 | IAM revisado (privilégio mínimo sobre a ARP) | Banco dedicado criado; negação administrativa pendente | `coala-rep-p` foi criado com PITR, proteção contra exclusão, backup diário e tag própria. Código, regras e índices foram separados; falta um administrador com `roles/iam.denyAdmin` aplicar a negação das contas genéricas sobre a tag ([inventário](iam-e-restauracao.md#inventário-iam)) |
| 10 | Decisões regulatórias do REP-P | Atendido | Não há parecer jurídico genérico como gate. As decisões e as duas validações técnicas restantes estão no [registro de normas](../referencias/README.md#decisões-registradas-e-validações-técnicas) |
| 11 | Certificados e ReSinc | Decidido | ACT não bloqueia a liberação. Preservar bytes/cadeia, monitorar e renovar e-CNPJ/e-CPFs antes do vencimento e impedir novas assinaturas com certificado vencido. ReSinc certificada não é requisito adotado; permanece a Hora Legal já implementada |
| 11-A | Pré-condições operacionais | Parcial, preservação provada | Bucket fiscal dedicado criado, variável preparada, escrita mínima concedida ao App Hosting e objeto sintético travado até 25/10/2046. Banco dedicado da ARP criado e protegido. AFD/AEJ só são entregues depois do ZIP preservado. Faltam publicar a configuração, aplicar a negação IAM condicionada à tag, cadastro fiscal/local aprovado, comunicação ao trabalhador e LGPD; os ensaios locais do assinador e do acesso por 72 h passaram |
| 12 | E2E da tela, Coala Go e piloto fiscal | Parcial | Em 23/10/2026 passaram o E2E local da tela pessoal × conferência administrativa, os testes JVM/lint do Coala Go e o APK assinado 0.3.21/code26. Offline, geolocalização pontual, troca de turno e acompanhamento de jornada estão implementados. Faltam aparelho físico, Play Integrity `enforce`, configuração operacional da localização e piloto fiscal com um único estabelecimento |

`REP_P_MARKING_ENABLED` só pode virar `true` com os gates 1–6, 8–11 e 11-A atendidos (o 7 vale para o PTRP), revisão do Doc Brown e decisão registrada do programador. Ligar essa flag inicia o **piloto fiscal do REP-P**, limitado a um estabelecimento e com o Bizneo como registro oficial. As obrigações do art. 80 e do Anexo IX valem desde a primeira batida oficial.

O **ensaio pré-homologação segregado** não antecipa essa decisão: `REP_P_PILOT_ENABLED=true` aceita somente as identidades nominais autorizadas e mantém `REP_P_MARKING_ENABLED=false`. Seus documentos dizem que não têm validade REP-P; os dados não podem ser promovidos, copiados ou convertidos em batida oficial. O servidor também impede qualquer mistura entre ajuste formal e ensaio no mesmo dia: pedido e batida disputam a mesma trava transacional, a batida procura solicitações anteriores e a aprovação relê trava e marcações. A existência de uma solicitação formal reserva o dia ao fluxo oficial, mesmo que depois rejeitada ou cancelada. Cada reclassificação do ensaio permanece em evento imutável. O objetivo é validar identidade, vínculo, unidade, fuso, Hora Legal, telas e prévia do banco antes da ativação fiscal. Geolocalização pontual e acompanhamento durante a jornada fazem parte do produto aprovado; durante o ensaio continuam desligados para pessoas reais até a publicação da cláusula/aditivo, configuração das unidades e dos turnos, acesso autorizado e teste físico. O acompanhamento usa `DP_JOURNEY_LOCATION_ENABLED=false` como kill switch até esses itens serem concluídos. O pacote mensal de comprovantes continua sendo exclusivamente oficial; o app não conta ensaios como parte dele e oferece o comprovante de ensaio somente na batida individual. A inspeção bruta confirmou que as quatro unidades não possuíam o campo `timeZone`; o rollout aceita somente esse estado exato para gravar `America/Fortaleza`, relendo e comparando a versão integral de cada unidade na transação antes de qualquer escrita.

## Pendências para considerar o ponto pronto, salvo INPI

Esta é a lista operacional vigente. Não entram nela homologação no MTE, Inmetro, CAREP, ReSinc ou parecer jurídico genérico. Migração do histórico, encerramento do sistema anterior e consulta geral de documentos no Coala Go também não fazem parte deste critério.

1. **Assinaturas e arquivos fiscais:** validar no ITI amostras reais PAdES/CAdES feitas com o e-CNPJ; validar uma assinatura de amostra com o e-CPF; conferir os bytes finais do AFD e o hash do registro tipo 7.
2. **Infraestrutura fiscal:** provisionar e provar o bucket fiscal com retenção imutável de 20 anos; reduzir o IAM da ARP ao privilégio mínimo; ensaiar restauração; simular perda e retomada da Hora Legal.
3. **Eventos e contingência do REP-P:** concluir os eventos de indisponibilidade/retorno do AFD; ensaiar falha do assinador e reemissão posterior; provar o acesso e a extração dos comprovantes das últimas 48 horas.
4. **Coala Go online e offline:** colocar Play Integrity da versão oficial em `enforce` e testar em aparelho físico batida online, autorização de 12 horas, queda e retorno de rede, reinício, bateria, fila cifrada, sincronização ordenada e recebimento posterior de NSR/comprovante.
5. **Geolocalização pontual:** publicar cláusula LGPD e aditivo, RIPD e aviso contextual; cadastrar área/raio e lista autorizada por unidade; testar permissões precisa, aproximada e negada; disponibilizar consulta auditada somente ao DP/diretoria autorizados.
6. **Acompanhamento durante a jornada:** a coleta Android, fila, pausa, retomada, encerramento e kill switch já existem. A regra permanece por turno: selecionar `Entre unidades` e `Durante a jornada` apenas nos turnos que exigem acompanhamento. Falta configurar os turnos reais, disponibilizar a consulta autorizada/auditada, testar em aparelho físico e então ligar `DP_JOURNEY_LOCATION_ENABLED`.
7. **Troca de turno:** o contrato central, aceite/recusa, inversão automática e telas web/Coala Go já existem. Falta apenas o ensaio ponta a ponta com duas contas reais da mesma unidade; não é desenvolvimento estrutural pendente.
8. **Configuração do piloto:** completar CNPJ, razão social, fuso, unidade, vínculo, cargo/função, jornada, turno, escala, permissões e política de localização das pessoas piloto; conferir primeiro Heucilene Ribeiro e Luis.
9. **PTRP integrado:** congelar a versão candidata e executar uma competência completa com batidas, ajustes, ausências, troca de turno, banco, fechamento individual/geral, espelho, AFD e AEJ; corrigir qualquer divergência antes da ativação geral.
10. **Validação independente:** executar a simulação fiscal e a revisão final do Doc Brown sobre exatamente a versão candidata, sem reabrir gates já decididos.

### Pendência separada: INPI

Protocolar e obter o número do registro do programa. Com o número definitivo, preencher e assinar os atestados do REP-P e do PTRP e configurar o identificador nos comprovantes e arquivos fiscais. Essa é a única dependência externa excluída da lista operacional acima.

## Ordem recomendada

1. Fechar assinaturas, AFD/hash e infraestrutura fiscal.
2. Finalizar offline, geolocalização e acompanhamento configurado por turno em aparelho físico.
3. Completar os cadastros da Heucilene e do Luis e executar a competência integrada de teste.
4. Congelar a versão candidata e executar validação independente/Doc Brown.
5. Protocolar o INPI e, com o número definitivo, assinar os atestados.
6. Ligar a coleta oficial para um único estabelecimento-piloto e avaliar antes de expandir.

## Arquivo fiscal imutável

AFD/AEJ e suas assinaturas destacadas usam um bucket separado do armazenamento geral. O backend cria um único ZIP não comprimido com manifesto, arquivo fiscal e assinatura, preservando os bytes exatos dos dois últimos. Ele recusa a exportação quando `REP_P_FISCAL_STORAGE_BUCKET` não existe, quando o bucket não tem **Object Retention** habilitado ou quando o pacote não volta da API com retenção `Locked` por 20 anos. A gravação usa precondição de geração zero, registra bucket, caminho, geração, SHA-256, tamanho e término real da retenção na auditoria e não responde sucesso se o pacote não estiver protegido.

Habilitar Object Retention é irreversível para o bucket e objetos em modo `Locked` não podem ter o prazo reduzido nem ser excluídos antes dele. Por isso, a criação/configuração do bucket e o IAM do runtime são um gate operacional deliberado, não uma mutação automática do deploy da aplicação. Depois do provisionamento, validar com `gcloud storage buckets describe gs://BUCKET --format="default(per_object_retention)"` e, numa amostra sem dados pessoais, conferir `retention_settings`, geração e SHA-256 dos dois objetos.

## Amostras

[`scripts/rep-p-homologation-samples.mts`](../../../scripts/rep-p-homologation-samples.mts) gera `AMOSTRA_AFD…REP_P.txt`, o `.p7s` e `AMOSTRA_comprovante-…pdf`. São assinados com o e-CNPJ real, mas com empregador e trabalhador fictícios (`AMOSTRA DE HOMOLOGACAO SEM VALIDADE`, CNPJ 11.222.333/0001-81) e INPI zerado; o PDF traz a faixa "AMOSTRA - SEM VALIDADE". Não leem nem escrevem em banco. Os identificadores de exemplo são tratados como dados sintéticos controlados; as amostras devem ser eliminadas depois da validação. O INPI zerado não prova o nome do arquivo nem o preenchimento reais.

A credencial passa só pela memória do processo; nada é gravado além das amostras:

```bash
gcloud secrets versions access 1 --secret=REP_P_ICP_SIGNER_PEM --project=smart-converter-752gf \
  | node --import tsx scripts/rep-p-homologation-samples.mts --out ~/amostras-rep-p --confirm-sample
```

O comando deve ser executado somente em sessão autenticada e autorizada, com o segredo fluindo diretamente para a memória do processo, sem impressão ou arquivo intermediário. Use uma pasta fora de diretórios sincronizados (como Desktop/iCloud) e apague as amostras depois de arquivar os relatórios do ITI. O script imprime apenas o SHA-256 de cada arquivo e recusa sem `--confirm-sample` ou com a chave digitada no terminal.

## Assinatura com e-CPF

O e-CPF A1 é pessoal: identifica quem assina o atestado como responsável técnico e/ou legal. Se a mesma pessoa acumular os dois papéis, assina os campos aplicáveis com o próprio e-CPF. Ele nunca entra no sistema, no repositório ou no Secret Manager.

1. Instalar o `.pfx` só no computador de quem assina (Acesso às Chaves no macOS) e guardar o arquivo e a senha em cofre próprio.
2. Gerar o PDF do atestado a partir de [atestados.md](atestados.md), com todos os campos preenchidos e sem os parênteses de instrução. Esse PDF é o definitivo: qualquer edição depois da assinatura a invalida.
3. Assinar em PAdES com o certificado ICP-Brasil, por exemplo pelo Adobe Acrobat Reader (Ferramentas → Certificados → Assinar digitalmente) ou pelo Assinador SERPRO. Quando houver dois signatários, cada um assina o mesmo PDF em sequência.
4. Validar o PDF assinado em [validar.iti.gov.br](https://validar.iti.gov.br); guardar o relatório junto do atestado.
5. Arquivar o atestado assinado para pronta apresentação à Inspeção do Trabalho e entregar cópia a cada empregador destinatário.
