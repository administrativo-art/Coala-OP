# Homologação do REP-P

Pacote para levar o REP-P do estado "publicado e bloqueado" à liberação de `REP_P_MARKING_ENABLED`. A coleta oficial permanece bloqueada. `REP_P_PILOT_ENABLED` pode sustentar ensaios nominais segregados, sem NSR, ARP, AFD, AEJ ou fechamento. Estado em 22/10/2026.

## Relatório de gates

| # | Gate | Estado | Evidência / próximo passo |
| --- | --- | --- | --- |
| 1 | Hora Legal (ON, UDP/123) com quórum e desvio ≤ 30 s | Atendido em produção | `clockState: ok` em 18/10/2026 ([guia do fluxo](../../engineering/flows/dp-time-recording.md)); falta simular perda/retomada publicada |
| 2 | Backup, PITR e proteção contra exclusão do `coala-rh` | Ligados | Conferido em 18/10/2026: PITR e proteção ativos, backup diário com retenção de 98 dias; **restauração ainda não ensaiada** ([roteiro](iam-e-restauracao.md)) |
| 3 | e-CNPJ A1 da desenvolvedora no Secret Manager | Atendido | `REP_P_ICP_SIGNER_PEM` v1, válido até 16/06/2027; vencimento monitorado pela central de avisos |
| 4 | Amostras AFD/CAdES e comprovante/PAdES aprovadas no ITI | Pendente | Gerar com o [script de amostras](#amostras) e seguir o [checklist ITI](validacao-iti.md) |
| 5 | e-CPF A1 do responsável técnico (e do responsável legal, se for outra pessoa) | Instalado localmente; validação pendente | O e-CPF informado pelo programador foi instalado em 21/10/2026. Falta assinar uma amostra e validar a cadeia/qualificação no ITI. Fica com cada pessoa; **não** vai ao sistema nem ao Secret Manager ([roteiro](#assinatura-com-e-cpf)) |
| 6 | Atestado Técnico e Termo de Responsabilidade do REP-P | Pendente | [Modelo preenchível](atestados.md#rep-p); depende do INPI (gate 8) |
| 7 | Atestado do PTRP | Pendente | Tratamentos, fechamento, espelho, AEJ e banco existem; falta fechar a versão candidata, validar o conjunto integrado e preencher/assinar o atestado correspondente |
| 8 | Registro do programa no INPI | Pendente, pacote técnico preparado | O [checklist do INPI](inpi.md) e o gerador reproduzível de ZIP/hash estão prontos. Faltam autores/titularidade, datas, requerente/signatário e a versão final; o número definitivo configura comprovante e AFD (13 dígitos, P&R 49) |
| 9 | IAM revisado (privilégio mínimo sobre `repP_*`) | Pendente, com achado | Conta padrão do Compute com `firebase.admin` alcança a ARP ([inventário](iam-e-restauracao.md#inventário-iam)) |
| 10 | Perguntas ao advogado respondidas | Pendente | [Registro de normas](../referencias/README.md#perguntas-abertas-ao-advogado): preenchimento numérico do AFD é irreversível após a 1ª batida real |
| 11 | Validade das assinaturas e ReSinc | Risco aberto | O e-CNPJ vence em 16/06/2027: sem carimbo do tempo (ACT), AFD e comprovantes de guarda longa podem perder verificabilidade. Decidir sobre ACT e o plano de renovação do e-CNPJ **antes** de ligar a flag; ReSinc/HLB certificada segue como decisão jurídica (gate 10) |
| 11-A | Pré-condições operacionais | Pendente, com preservação implementada | AFD/AEJ agora só são entregues depois de arquivar um ZIP único com os bytes exatos do `.txt` e do `.p7s`, mais manifesto; o código exige bucket fiscal dedicado com retenção por objeto em modo `Locked` por 20 anos. Falta provisionar esse bucket, configurar `REP_P_FISCAL_STORAGE_BUCKET`, conceder IAM mínimo e provar a trava. Também faltam cadastro fiscal/local aprovado, política de indisponibilidade do assinador, ensaio do acesso às últimas 48 h, comunicação ao trabalhador e LGPD |
| 12 | E2E da tela, Coala Go e piloto paralelo ao Bizneo | Parcial | Em 23/10/2026 passaram o E2E local da tela pessoal × conferência administrativa, os testes JVM/lint do Coala Go e o APK assinado 0.3.21/code26, que distingue o ensaio nominal do registro oficial e isola perfil, escala e resumo diário ao alternar a identidade visualizada. Faltam aparelho físico, Play Integrity `enforce` e piloto fiscal com um único estabelecimento, mantendo o Bizneo como registro oficial (pergunta 4) |

`REP_P_MARKING_ENABLED` só pode virar `true` com os gates 1–6, 8–11 e 11-A atendidos (o 7 vale para o PTRP), revisão do Doc Brown e decisão registrada do programador. Ligar essa flag inicia o **piloto fiscal do REP-P**, limitado a um estabelecimento e com o Bizneo como registro oficial. As obrigações do art. 80 e do Anexo IX valem desde a primeira batida oficial.

O **ensaio pré-homologação segregado** não antecipa essa decisão: `REP_P_PILOT_ENABLED=true` aceita somente as identidades nominais autorizadas e mantém `REP_P_MARKING_ENABLED=false`. Seus documentos dizem que não têm validade REP-P; os dados não podem ser promovidos, copiados ou convertidos em batida oficial. O servidor também impede qualquer mistura entre ajuste formal e ensaio no mesmo dia: pedido e batida disputam a mesma trava transacional, a batida procura solicitações anteriores e a aprovação relê trava e marcações. A existência de uma solicitação formal reserva o dia ao fluxo oficial, mesmo que depois rejeitada ou cancelada. Cada reclassificação do ensaio permanece em evento imutável. O objetivo é validar identidade, vínculo, unidade, fuso, Hora Legal, telas e prévia do banco antes da migração. O Bizneo permanece a fonte oficial. A localização do ensaio é forçada para `disabled` no servidor, inclusive diante de política anterior ativa ou tentativa enviada pelo cliente, e o acompanhamento contínuo permanece explicitamente desligado por `DP_JOURNEY_LOCATION_ENABLED=false`, até a cláusula/aditivo e a decisão jurídica aplicáveis estarem documentados. O pacote mensal de comprovantes continua sendo exclusivamente oficial; o app não conta ensaios como parte dele e oferece o comprovante de ensaio somente na batida individual. A inspeção bruta confirmou que as quatro unidades não possuíam o campo `timeZone`; o rollout aceita somente esse estado exato para gravar `America/Fortaleza`, relendo e comparando a versão integral de cada unidade na transação antes de qualquer escrita.

## Ordem recomendada

1. Validar no ITI uma assinatura de amostra feita com o e-CPF instalado.
2. Responder com o advogado as perguntas do registro de normas, inclusive a acumulação de responsável legal e técnico pela mesma pessoa e se um único e-CPF assina os dois campos.
3. Preencher o [checklist do INPI](inpi.md), congelar a versão, gerar o ZIP/hash e protocolar o registro.
4. Gerar as amostras e validá-las no ITI.
5. Provisionar o bucket fiscal com retenção por objeto, configurar `REP_P_FISCAL_STORAGE_BUCKET`, ensaiar a restauração e revisar o IAM.
6. Com o número definitivo do INPI em mãos, preencher e assinar o atestado do REP-P.
7. Concluir E2E e Coala Go; ligar a flag para um único estabelecimento-piloto; avaliar antes de expandir.

## Arquivo fiscal imutável

AFD/AEJ e suas assinaturas destacadas usam um bucket separado do armazenamento geral. O backend cria um único ZIP não comprimido com manifesto, arquivo fiscal e assinatura, preservando os bytes exatos dos dois últimos. Ele recusa a exportação quando `REP_P_FISCAL_STORAGE_BUCKET` não existe, quando o bucket não tem **Object Retention** habilitado ou quando o pacote não volta da API com retenção `Locked` por 20 anos. A gravação usa precondição de geração zero, registra bucket, caminho, geração, SHA-256, tamanho e término real da retenção na auditoria e não responde sucesso se o pacote não estiver protegido.

Habilitar Object Retention é irreversível para o bucket e objetos em modo `Locked` não podem ter o prazo reduzido nem ser excluídos antes dele. Por isso, a criação/configuração do bucket e o IAM do runtime são um gate operacional deliberado, não uma mutação automática do deploy da aplicação. Depois do provisionamento, validar com `gcloud storage buckets describe gs://BUCKET --format="default(per_object_retention)"` e, numa amostra sem dados pessoais, conferir `retention_settings`, geração e SHA-256 dos dois objetos.

## Amostras

[`scripts/rep-p-homologation-samples.mts`](../../../scripts/rep-p-homologation-samples.mts) gera `AMOSTRA_AFD…REP_P.txt`, o `.p7s` e `AMOSTRA_comprovante-…pdf`. São assinados com o e-CNPJ real, mas com empregador e trabalhador fictícios (`AMOSTRA DE HOMOLOGACAO SEM VALIDADE`, CNPJ 11.222.333/0001-81) e INPI zerado; o PDF traz a faixa "AMOSTRA - SEM VALIDADE". Não leem nem escrevem em banco. O CNPJ e o CPF de exemplo têm dígitos válidos e podem coincidir com pessoas reais (pergunta 7 ao advogado). O INPI zerado não prova o nome do arquivo nem o preenchimento reais.

A credencial passa só pela memória do processo; nada é gravado além das amostras:

```bash
gcloud secrets versions access 1 --secret=REP_P_ICP_SIGNER_PEM --project=smart-converter-752gf \
  | node --import tsx scripts/rep-p-homologation-samples.mts --out ~/amostras-rep-p --confirm-sample
```

A pessoa programadora executa esse comando no próprio terminal: ler o valor do segredo não é tarefa de agente. Use uma pasta fora de diretórios sincronizados (como Desktop/iCloud) e apague as amostras depois de arquivar os relatórios do ITI. O script imprime o SHA-256 de cada arquivo e recusa sem `--confirm-sample` ou com a chave digitada no terminal.

## Assinatura com e-CPF

O e-CPF A1 é pessoal: identifica quem assina o atestado como responsável técnico e, se o advogado confirmar, também como responsável legal. Ele nunca entra no sistema, no repositório ou no Secret Manager.

1. Instalar o `.pfx` só no computador de quem assina (Acesso às Chaves no macOS) e guardar o arquivo e a senha em cofre próprio.
2. Gerar o PDF do atestado a partir de [atestados.md](atestados.md), com todos os campos preenchidos e sem os parênteses de instrução. Esse PDF é o definitivo: qualquer edição depois da assinatura a invalida.
3. Assinar em PAdES com o certificado ICP-Brasil, por exemplo pelo Adobe Acrobat Reader (Ferramentas → Certificados → Assinar digitalmente) ou pelo Assinador SERPRO. Quando houver dois signatários, cada um assina o mesmo PDF em sequência.
4. Validar o PDF assinado em [validar.iti.gov.br](https://validar.iti.gov.br); guardar o relatório junto do atestado.
5. Arquivar o atestado assinado para pronta apresentação à Inspeção do Trabalho e entregar cópia a cada empregador destinatário.
