# Homologação do REP-P

## Decisão de 31/10/2026 — ativação antecipada em preparação

O programador autorizou preparar a coleta com INPI vazio, sem identificador fictício, e substituir a lista nominal oficial pela permissão `app.timeRecording.mark` e pela elegibilidade do vínculo vigente (CLT/aprendiz), unidade e estabelecimento. A lista nominal do ensaio segregado permanece própria desse ensaio. Os comprovantes preservam o campo INPI vazio; AFD e AEJ não inventam número. Quando o INPI chegar, os bytes e assinaturas anteriores não serão reescritos.

Doc Brown classificou essa candidata como **não conforme para declarar REP-P regular**: o registro no INPI e os atestados não foram emitidos, e o campo obrigatório dos arquivos fiscais ficará vazio. A decisão do programador de assumir a questão jurídica foi explícita; ela não altera esse veredito técnico. A coleta ainda está **desligada** até publicação, cadastro fiscal e conferência do runtime. O corte proposto para 31/10 não encontrou marcações, autorizações offline, travas de dia nem pedidos de ajuste nessa data nas consultas limitadas feitas antes da publicação.

O CPF do responsável Tiago foi confirmado no RH por leitura sem exposição do número. A deny policy protege a ARP contra escrita por usuário administrativo; por isso, o cadastro fiscal idempotente ocorre no runtime autorizado na primeira ação de escrita do próprio trabalhador (marcação ou autorização offline), após vínculo elegível, CPF, unidade e Hora Legal. A consulta de opções e a visualização como outra pessoa permanecem somente leitura. Em 31/10, a auditoria encontrou dois elegíveis com identidade fiscal completa, Heucilene e Luís; não havia estabelecimento nem empregados provisionados na ARP. A integração no emulador cobriu duas marcações concorrentes, cadastro único e leitura sem escrita.

Próximos passos: publicar a candidata, conferir o rollout e ativar `REP_P_MARKING_ENABLED`; a primeira batida deve criar os eventos fiscais de estabelecimento/empregado antes do evento de marcação. Depois das batidas feitas pelos titulares, verificar NSR, comprovante, sincronização online/offline, ajustes que ocorram, espelho, AFD e AEJ. A auditoria de 31/10 encontrou zero políticas de localização ativas, zero definições de turno ativas para posição e zero turnos ativos para posição; localização pontual depende do aditivo conduzido pelo RH e da configuração por unidade. O acompanhamento contínuo permanecerá desligado na promoção. Anexar a evidência já produzida do AEJ/CAdES e concluir INPI/atestados sem alterar originais anteriores.

Pacote para acompanhar a preparação e a liberação de `REP_P_MARKING_ENABLED`. O plano original de 26/10 previa corte em novembro e lista nominal; a decisão vigente de 31/10, acima, os substituiu. As seções históricas abaixo registram a evolução e não são gates atuais quando divergirem da decisão de 31/10.

## Fonte canônica do estado documental

Esta seção é a fonte única de verdade para certificados, assinaturas, relatórios do ITI, atestados, INPI e arquivo fiscal. Uma atividade concluída aqui não deve voltar a ser listada como pendente em planos, revisões ou relatórios. Quando existir declaração do responsável sem o arquivo no dossiê atual, o único trabalho documental restante é anexar a evidência — não repetir o ensaio.

| Item | Estado documental | Evidência e decisão registrada |
| --- | --- | --- |
| Comprovante/PAdES | **Validado no ITI em 25/10/2026** | Relatório aprovado, sem alertas, com cadeia, estrutura, resumo e atributos válidos. SHA-256 e ID do Coala One em [evidências de 25/10](evidencias/2026-10-25/README.md). |
| AFD/CAdES | **Validado no ITI em 25/10/2026** | Arquivo, `.p7s` destacado e relatório aprovado estão no dossiê; os hashes conferem e a assinatura destacada também foi verificada localmente. |
| AEJ/CAdES | **Validação concluída segundo declaração do responsável em 26/10/2026; evidência ainda não localizada no dossiê atual** | O assinador CAdES é o mesmo já comprovado no AFD. Não repetir a validação por padrão; localizar e anexar o AEJ, o `.p7s` e/ou o relatório já emitido para completar a cadeia documental. |
| e-CNPJ da desenvolvedora | **Configurado e válido** | Certificado de `CT SORVETES LTDA`, CNPJ `14.276.603/0001-25`, no Secret Manager, válido até 16/06/2027. |
| e-CPF do responsável técnico | **Validado no ITI em 25/10/2026** | Relatório aprovado da assinatura de TIAGO FRANCISCO BRASIL BATISTA, arquivado localmente e no Coala One. O certificado pessoal não fica no sistema nem no repositório. |
| Papéis institucionais | **Definidos** | `CT SORVETES LTDA` é a pessoa jurídica desenvolvedora do REP-P e também a empregadora destinatária no uso próprio. TIAGO FRANCISCO BRASIL BATISTA é o responsável técnico. No atestado, o campo de assinatura do responsável legal é preenchido por uma pessoa física com poderes para representar a empresa; isso não cria outra desenvolvedora nem transfere a responsabilidade da CT Sorvetes. |
| Atestado REP-P | **Conteúdo pronto; aguarda somente INPI para emissão definitiva** | Após receber número e certificado do INPI, preencher esses campos, congelar a versão e colher as assinaturas pessoais aplicáveis. Não há homologação adicional do MTE, Inmetro ou CAREP. |
| Atestado PTRP | **Modelo pronto; aguarda INPI e fechamento da versão candidata** | A simulação integrada é um gate técnico para declarar a versão, não uma nova exigência documental externa. Depois dela e do INPI, preencher a versão e colher as assinaturas. |
| Registro do programa no INPI | **Pendente** | Pacote técnico e checklist preparados; faltam protocolo, número e certificado definitivos. |
| Arquivo fiscal imutável | **Provisionado e conferido em 26/10/2026** | Bucket `smart-converter-752gf-rep-p-fiscal` com acesso público bloqueado, acesso uniforme e retenção por objeto habilitada. Objeto sintético de prova em modo `Locked` até 25/10/2046. |

Arquivos de ensaio comprovam o mecanismo criptográfico, mas não transformam marcações de outubro em registros oficiais. Depois do INPI, a conferência final deve apenas confirmar que o número definitivo e os bytes finais foram incorporados corretamente; ela não reabre as validações criptográficas já aprovadas.

## Decisão operacional de 25/10/2026 — substituída em 31/10

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
| 4 | Amostras PAdES e CAdES aprovadas no ITI | Atendido | Comprovante/PAdES e AFD/CAdES têm evidência arquivada em [evidencias/2026-10-25](evidencias/2026-10-25/README.md). A validação AEJ/CAdES foi declarada concluída pelo responsável em 26/10; falta somente anexar o respectivo artefato/relatório ao dossiê atual. Depois do INPI, conferir apenas os bytes finais. |
| 5 | e-CPF A1 do responsável técnico (e do responsável legal, se for outra pessoa) | Validado em 25/10/2026 | A amostra foi assinada pelo titular e o relatório do VALIDAR/ITI foi aprovado; o relatório está arquivado no Coala One e na [evidência local](evidencias/2026-10-25/README.md). A amostra assinada permanece fora do sistema e do repositório ([roteiro](#assinatura-com-e-cpf)) |
| 6 | Atestado Técnico e Termo de Responsabilidade do REP-P | Aguarda somente INPI | [Modelo preenchível](atestados.md#rep-p); com o INPI, congelar a versão e emitir o documento definitivo para assinatura |
| 7 | Atestado do PTRP | Aguarda INPI e versão candidata | O modelo está pronto. A simulação integrada fecha a versão técnica declarada; depois, preencher e assinar o documento definitivo |
| 8 | Registro do programa no INPI | Pendente, pacote técnico preparado | Titular/desenvolvedora definidos como CT SORVETES LTDA. O [checklist do INPI](inpi.md) e o gerador reproduzível de ZIP/hash estão prontos; resta fechar os dados do protocolo e a versão depositada. O número definitivo configura comprovante e AFD (13 dígitos, P&R 49) |
| 9 | IAM revisado (privilégio mínimo sobre a ARP) | Atendido | `coala-rep-p` tem PITR, proteção contra exclusão, backup diário, tag, regras, cinco índices `READY` e TTL `ACTIVE`. Em 25/10, a deny policy condicionada à tag passou a negar criação/alteração/exclusão às contas genéricas, preservando somente App Hosting e o agente do Firestore ([inventário](iam-e-restauracao.md#inventário-iam)) |
| 10 | Decisões regulatórias do REP-P | Atendido | Não há parecer jurídico genérico como gate. As decisões e o estado das validações estão no [registro de normas](../referencias/README.md#decisões-registradas-e-validações-técnicas) e na fonte canônica acima |
| 11 | Certificados e ReSinc | Decidido | ACT não bloqueia a liberação. Preservar bytes/cadeia, monitorar e renovar e-CNPJ/e-CPFs antes do vencimento e impedir novas assinaturas com certificado vencido. ReSinc certificada não é requisito adotado; permanece a Hora Legal já implementada |
| 11-A | Pré-condições operacionais | Parcial, infraestrutura publicada | Bucket fiscal e retenção `Locked` foram reconferidos ao vivo em 26/10/2026; banco dedicado protegido; deny policy aplicada; primeira restauração do `coala-rep-p` concluída com comparação idêntica e destino descartável removido. AFD/AEJ só são entregues depois do ZIP preservado. `REP_P_MARKING_ENABLED=false` permanece. Faltam aprovar cadastro fiscal/local, comunicar os trabalhadores e concluir LGPD; os ensaios locais do assinador e do acesso por 72 h passaram |
| 12 | E2E da tela, Coala Go e piloto fiscal | Parcial | Em 23/10/2026 passaram o E2E local da tela pessoal × conferência administrativa, os testes JVM/lint do Coala Go e o APK assinado 0.3.21/code26. Offline, geolocalização pontual, troca de turno e acompanhamento de jornada estão implementados. Faltam aparelho físico, Play Integrity `enforce`, configuração operacional da localização e piloto fiscal com um único estabelecimento |

O critério de ativação originalmente aprovado em 25/10 exigia início em novembro, gates 1–6 e 8–11-A e revisão Doc Brown. A decisão posterior de 31/10 antecipou a data, removeu a lista nominal oficial e aceitou INPI vazio sob responsabilidade do programador. Doc Brown manteve veredito não conforme; a primeira batida dessa candidata não deve ser descrita como REP-P regular.

O **ensaio pré-homologação segregado** não antecipa essa decisão: `REP_P_PILOT_ENABLED=true` aceita somente as identidades nominais autorizadas e mantém `REP_P_MARKING_ENABLED=false`. Seus documentos dizem que não têm validade REP-P; os dados não podem ser promovidos, copiados ou convertidos em batida oficial. A contingência do ensaio usa autorização, coleção e domínio de assinatura próprios e pode ser testada sem rede ou após indisponibilidade explícita da HLB; a sincronização continua fora de NSR, ARP, AFD, AEJ, espelho e fechamento. O servidor também impede qualquer mistura entre ajuste formal e ensaio no mesmo dia: pedido e batida disputam a mesma trava transacional, a batida procura solicitações anteriores e a aprovação relê trava e marcações. A existência de uma solicitação formal reserva o dia ao fluxo oficial, mesmo que depois rejeitada ou cancelada. Cada reclassificação do ensaio permanece em evento imutável. O objetivo é validar identidade, vínculo, unidade, fuso, Hora Legal, telas, contingência e prévia do banco antes da ativação fiscal. Geolocalização pontual e acompanhamento durante a jornada fazem parte do produto aprovado; durante o ensaio continuam desligados para pessoas reais até a publicação da cláusula/aditivo, configuração das unidades e dos turnos, acesso autorizado e teste físico. O acompanhamento usa `DP_JOURNEY_LOCATION_ENABLED=false` como kill switch até esses itens serem concluídos. O pacote mensal de comprovantes continua sendo exclusivamente oficial; o app não conta ensaios como parte dele e oferece o comprovante de ensaio somente na batida individual. A inspeção bruta confirmou que as quatro unidades não possuíam o campo `timeZone`; o rollout aceita somente esse estado exato para gravar `America/Fortaleza`, relendo e comparando a versão integral de cada unidade na transação antes de qualquer escrita.

## Pendências da fotografia de 26/10 — consultar atualização de 31/10 acima

Esta é a lista operacional vigente. Não entram nela homologação no MTE, Inmetro, CAREP, ReSinc ou parecer jurídico genérico. Migração do histórico, encerramento do sistema anterior e consulta geral de documentos no Coala Go também não fazem parte deste critério.

1. **Assinaturas e arquivos fiscais:** a verificação local de PAdES com DocMDP, CAdES AD-RB, cadeia ICP-Brasil, AFD e hash tipo 7 e a validação externa do AFD/CAdES e do comprovante/PAdES passaram em 25/10. O e-CPF também foi validado e arquivado. A validação do AEJ/CAdES foi declarada concluída pelo responsável; falta localizar e anexar sua evidência ao dossiê, sem refazer o ensaio. Após o INPI, conferir somente os bytes finais com o número definitivo.
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

## Ordem recomendada em 26/10 — substituída pela atualização de 31/10

1. Anexar ao dossiê a evidência já produzida do AEJ/CAdES; não repetir a validação, salvo se o arquivo final mudar.
2. Finalizar offline, geolocalização e acompanhamento configurado por turno em aparelho físico, antes do piloto de novembro.
3. Completar os cadastros da Heucilene e do Luis (ou somente um deles, conforme a escolha final) e executar a competência integrada de teste.
4. Publicar e ensaiar a monitoração externa que origina os eventos tipo 6.
5. Congelar a versão candidata, executar a simulação fiscal e fazer a revisão final do Doc Brown.
6. Protocolar o INPI; inserir número/certificado, conferir os bytes finais e assinar os atestados.
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
