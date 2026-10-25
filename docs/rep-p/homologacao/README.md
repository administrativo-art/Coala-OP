# Homologação do REP-P

Pacote para levar o REP-P do estado "publicado e bloqueado" à liberação de `REP_P_MARKING_ENABLED`. A competência de **outubro/2026 permanece exclusivamente como ensaio nominal segregado**. A competência de **novembro/2026 será o piloto controlado**, limitado a uma unidade e a um ou dois colaboradores autorizados. Estado em 25/10/2026.

## Decisão operacional registrada em 25/10/2026

- Outubro/2026: ensaio segregado, sem validade fiscal, sem NSR/ARP/AFD/AEJ e sem fechamento oficial.
- Novembro/2026: teste controlado com um ou dois colaboradores-piloto, em uma unidade, após publicação do backend, testes físicos e conferência das pré-condições.
- A coleta oficial continua bloqueada até que a versão publicada esteja confirmada e o início do piloto de novembro seja preparado.
- Atenção de segurança: hoje `REP_P_MARKING_ENABLED=true` libera o modo oficial para qualquer perfil que tenha `app.timeRecording.mark`; a lista `REP_P_PILOT_USER_IDS` só limita o modo de ensaio. Antes do piloto oficial de novembro, é necessário criar e testar uma allowlist oficial de um ou dois colaboradores (ou um escopo equivalente por unidade), para não liberar todos os empregados.

## Relatório de gates

| # | Gate | Estado | Evidência / próximo passo |
| --- | --- | --- | --- |
| 1 | Hora Legal (ON, UDP/123) com quórum e desvio ≤ 30 s | Atendido em produção | `clockState: ok` em 18/10/2026 ([guia do fluxo](../../engineering/flows/dp-time-recording.md)); falta simular perda/retomada publicada |
| 2 | Backup, PITR e proteção contra exclusão do `coala-rh` | Atendido para backup/restauração | PITR e proteção ativos, backup diário com retenção de 98 dias; restauração real em banco descartável concluída em 24/10/2026, com contagens idênticas e remoção do destino de ensaio ([evidência](iam-e-restauracao.md#ensaio-executado-em-24102026)) |
| 3 | e-CNPJ A1 da desenvolvedora no Secret Manager | Atendido | `REP_P_ICP_SIGNER_PEM` v1, válido até 16/06/2027; vencimento monitorado pela central de avisos |
| 4 | Amostras AFD/CAdES e comprovante/PAdES aprovadas no ITI | Atendido em 25/10/2026 | As amostras foram submetidas ao VALIDAR/ITI. O AFD/CAdES e o comprovante/PAdES tiveram assinatura, cadeia, estrutura, resumo criptográfico e atributos aprovados, sem alertas. Evidências arquivadas em [evidencias/2026-10-25](evidencias/2026-10-25/README.md); repetir a conferência dos bytes finais após preencher o INPI definitivo. |
| 5 | e-CPF A1 do responsável técnico (e do responsável legal, se for outra pessoa) | Validado em 25/10/2026 | A amostra foi assinada pelo titular e o relatório do VALIDAR/ITI foi aprovado; o relatório está arquivado no Coala One e na [evidência local](evidencias/2026-10-25/README.md). A amostra assinada permanece fora do sistema e do repositório ([roteiro](#assinatura-com-e-cpf)) |
| 6 | Atestado Técnico e Termo de Responsabilidade do REP-P | Pendente | [Modelo preenchível](atestados.md#rep-p); depende do INPI (gate 8) |
| 7 | Atestado do PTRP | Pendente | Tratamentos, fechamento, espelho, AEJ e banco existem; falta fechar a versão candidata, validar o conjunto integrado e preencher/assinar o atestado correspondente |
| 8 | Registro do programa no INPI | Pendente, pacote técnico preparado | O [checklist do INPI](inpi.md) e o gerador reproduzível de ZIP/hash estão prontos. Faltam autores/titularidade, datas, requerente/signatário e a versão final; o número definitivo configura comprovante e AFD (13 dígitos, P&R 49) |
| 9 | IAM revisado (privilégio mínimo sobre a ARP) | Atendido | `coala-rep-p` tem PITR, proteção contra exclusão, backup diário, tag, regras, cinco índices `READY` e TTL `ACTIVE`. Em 25/10, a deny policy condicionada à tag passou a negar criação/alteração/exclusão às contas genéricas, preservando somente App Hosting e o agente do Firestore ([inventário](iam-e-restauracao.md#inventário-iam)) |
| 10 | Decisões regulatórias do REP-P | Atendido | Não há parecer jurídico genérico como gate. As decisões e as duas validações técnicas restantes estão no [registro de normas](../referencias/README.md#decisões-registradas-e-validações-técnicas) |
| 11 | Certificados e ReSinc | Decidido | ACT não bloqueia a liberação. Preservar bytes/cadeia, monitorar e renovar e-CNPJ/e-CPFs antes do vencimento e impedir novas assinaturas com certificado vencido. ReSinc certificada não é requisito adotado; permanece a Hora Legal já implementada |
| 11-A | Pré-condições operacionais | Parcial, infraestrutura publicada | Bucket fiscal dedicado e objeto travado até 25/10/2046; banco dedicado protegido; deny policy aplicada; primeira restauração do `coala-rep-p` concluída com comparação idêntica e destino descartável removido. AFD/AEJ só são entregues depois do ZIP preservado. `REP_P_MARKING_ENABLED=false` permanece. Faltam aprovar cadastro fiscal/local, comunicar os trabalhadores e concluir LGPD; os ensaios locais do assinador e do acesso por 72 h passaram |
| 12 | E2E da tela, Coala Go e piloto fiscal | Parcial | Em 23/10/2026 passaram o E2E local da tela pessoal × conferência administrativa, os testes JVM/lint do Coala Go e o APK assinado 0.3.21/code26. Offline, geolocalização pontual, troca de turno e acompanhamento de jornada estão implementados. Faltam aparelho físico, Play Integrity `enforce`, configuração operacional da localização e piloto fiscal com um único estabelecimento |

`REP_P_MARKING_ENABLED` só pode virar `true` para o início do piloto de novembro com os gates 1–6, 8–11 e 11-A atendidos (o 7 vale para o PTRP), revisão do Doc Brown e decisão registrada do programador. Ligar essa flag inicia o **piloto fiscal do REP-P**, limitado a um estabelecimento e com o Bizneo como registro oficial. As obrigações do art. 80 e do Anexo IX valem desde a primeira batida oficial de novembro.

O **ensaio pré-homologação segregado** não antecipa essa decisão: `REP_P_PILOT_ENABLED=true` aceita somente as identidades nominais autorizadas e mantém `REP_P_MARKING_ENABLED=false`. Seus documentos dizem que não têm validade REP-P; os dados não podem ser promovidos, copiados ou convertidos em batida oficial. O servidor também impede qualquer mistura entre ajuste formal e ensaio no mesmo dia: pedido e batida disputam a mesma trava transacional, a batida procura solicitações anteriores e a aprovação relê trava e marcações. A existência de uma solicitação formal reserva o dia ao fluxo oficial, mesmo que depois rejeitada ou cancelada. Cada reclassificação do ensaio permanece em evento imutável. O objetivo é validar identidade, vínculo, unidade, fuso, Hora Legal, telas e prévia do banco antes da ativação fiscal. Geolocalização pontual e acompanhamento durante a jornada fazem parte do produto aprovado; durante o ensaio continuam desligados para pessoas reais até a publicação da cláusula/aditivo, configuração das unidades e dos turnos, acesso autorizado e teste físico. O acompanhamento usa `DP_JOURNEY_LOCATION_ENABLED=false` como kill switch até esses itens serem concluídos. O pacote mensal de comprovantes continua sendo exclusivamente oficial; o app não conta ensaios como parte dele e oferece o comprovante de ensaio somente na batida individual. A inspeção bruta confirmou que as quatro unidades não possuíam o campo `timeZone`; o rollout aceita somente esse estado exato para gravar `America/Fortaleza`, relendo e comparando a versão integral de cada unidade na transação antes de qualquer escrita.

## Pendências para considerar o ponto pronto, salvo INPI

Esta é a lista operacional vigente. Não entram nela homologação no MTE, Inmetro, CAREP, ReSinc ou parecer jurídico genérico. Migração do histórico, encerramento do sistema anterior e consulta geral de documentos no Coala Go também não fazem parte deste critério.

1. **Assinaturas e arquivos fiscais:** a verificação local de PAdES com DocMDP, CAdES AD-RB, cadeia ICP-Brasil, AFD e hash tipo 7 e a validação externa do AFD/CAdES e do comprovante/PAdES passaram em 25/10. As evidências foram arquivadas no Coala One. Falta repetir a conferência dos bytes finais após preencher o INPI definitivo e arquivar a validação do e-CPF quando o relatório estiver disponível.
2. **Infraestrutura fiscal:** bucket imutável, banco dedicado, PITR, proteção contra exclusão, backup diário, regras, índices, TTL, deny policy e restaurações de `coala-rh` e `coala-rep-p` estão concluídos. Falta repetir a perda/retomada da Hora Legal no ambiente publicado antes da ativação.
3. **Eventos e contingência do REP-P:** falha do assinador, reemissão sem nova batida e acesso posterior por 72 horas passaram no emulador. A candidata de 25/10 implementa sonda real, Cloud Monitoring, Pub/Sub, relay sem acesso à ARP e eventos tipo 6 idempotentes no App Hosting. Segredo, tópico e canal já existem; faltam publicar, criar o uptime check/policy e ensaiar abertura/fechamento com a coleta oficial desligada.
4. **Coala Go online e offline:** colocar Play Integrity da versão oficial em `enforce` e testar em aparelho físico batida online, autorização de 12 horas, queda e retorno de rede, reinício, bateria, fila cifrada, sincronização ordenada e recebimento posterior de NSR/comprovante.
5. **Geolocalização pontual:** publicar cláusula LGPD e aditivo, RIPD e aviso contextual; cadastrar área/raio e lista autorizada por unidade; testar permissões precisa, aproximada e negada; disponibilizar consulta auditada somente ao DP/diretoria autorizados.
6. **Acompanhamento durante a jornada:** a coleta Android, fila, pausa, retomada, encerramento e kill switch já existem. A regra permanece por turno: selecionar `Entre unidades` e `Durante a jornada` apenas nos turnos que exigem acompanhamento. Falta configurar os turnos reais, disponibilizar a consulta autorizada/auditada, testar em aparelho físico e então ligar `DP_JOURNEY_LOCATION_ENABLED`.
7. **Troca de turno:** o contrato central, aceite/recusa, inversão automática e telas web/Coala Go já existem. Falta apenas o ensaio ponta a ponta com duas contas reais da mesma unidade; não é desenvolvimento estrutural pendente.
8. **Configuração do piloto:** completar CNPJ, razão social, fuso, unidade, vínculo, cargo/função, jornada, turno, escala, permissões e política de localização das pessoas piloto; conferir primeiro Heucilene Ribeiro e Luis.
9. **PTRP integrado:** congelar a versão candidata e executar uma competência completa com batidas, ajustes, ausências, troca de turno, banco, fechamento individual/geral, espelho, AFD e AEJ; corrigir qualquer divergência antes da ativação geral.
10. **Validação independente:** a revisão pré-publicação do Doc Brown declarou o diff `CONFORME` para commit e publicação com a flag desligada; não certificou a implantação nem concluiu a validação fiscal. Depois dos ensaios físicos e da competência integrada, executar a simulação fiscal e uma revisão final sobre exatamente a nova versão candidata, sem reabrir gates já decididos.

### Pendência separada: INPI

Protocolar e obter o número do registro do programa. Com o número definitivo, preencher e assinar os atestados do REP-P e do PTRP e configurar o identificador nos comprovantes e arquivos fiscais. Essa é a única dependência externa excluída da lista operacional acima.

## Ordem recomendada

1. Repetir a conferência final dos bytes depois do número definitivo do INPI.
2. Finalizar offline, geolocalização e acompanhamento configurado por turno em aparelho físico, antes do piloto de novembro.
3. Completar os cadastros da Heucilene e do Luis (ou somente um deles, conforme a escolha final) e executar a competência integrada de teste.
4. Publicar e ensaiar a monitoração externa que origina os eventos tipo 6.
5. Congelar a versão candidata e executar simulação fiscal e revisão final do Doc Brown.
6. Protocolar o INPI e, com o número definitivo, assinar os atestados.
7. Ligar a coleta oficial para um único estabelecimento-piloto e avaliar antes de expandir.

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
