# IAM e restauração da ARP

## Inventário IAM

Levantado por leitura da política do projeto `smart-converter-752gf` em 18/10/2026 e revisto em 24/10/2026 (fotografia; refazer na revisão final). Logs de auditoria de acesso a dados do Firestore não foram avaliados. Lista quem consegue escrever via Admin SDK; regras deny-all não se aplicam a essas identidades.

| Principal | Papel | Uso | Avaliação |
| --- | --- | --- | --- |
| `firebase-app-hosting-compute@…` | `firebase.sdkAdminServiceAgent`, `firebaseapphosting.computeRunner` | App Coala One (único escritor legítimo da ARP) | Necessário |
| `787876557774-compute@developer…` | `firebase.admin` | Conta padrão das Cloud Functions de 2ª geração | **Achado:** qualquer função alcança a ARP. Recomendar conta dedicada com papéis mínimos por função |
| `787876557774@cloudservices…` | `editor` | Agente do Google APIs | Padrão do Google; manter |
| `firebase-adminsdk-fbsvc@…` | `firebase.sdkAdminServiceAgent` | Admin SDK do Firebase | Conferir se há chave exportada em uso; preferir nenhuma |
| `service-…@gcp-sa-firestore…` | `firestore.serviceAgent` | Agente do Firestore (backup/PITR) | Padrão; manter |
| usuário administrativo `ad…@coalashakes.com` | `owner` | Administração | Usar com MFA; registrar ações sobre `coala-rh` |

Controles em código: `firestore.rh.rules` nega `repP_*` a clientes e o teste `dp-rep-p-arp-deletion-guard` impede exclusão e enumeração de coleções no código.

O IAM do Firestore não concede papéis por coleção. Por decisão do programador em 24/10/2026, a ARP oficial foi separada no banco `coala-rep-p`; piloto, PTRP e RH permanecem no `coala-rh`. O banco dedicado foi criado em `southamerica-east1`, com PITR, proteção contra exclusão e backup diário retido por 98 dias. Uma tag `smart-converter-752gf/rep-p-arp/protected` identifica a fronteira.

O código usa `REP_P_FIRESTORE_DATABASE_ID=coala-rep-p`; regras próprias negam todo acesso direto de clientes e índices próprios atendem AFD, comprovantes e monitoração. Reclassificações posteriores passaram a ser sobreposições auditáveis em `ptrp_markingClassifications`, no PTRP, sem atualizar o comprovante ou a marcação original na ARP. O ensaio nominal permanece no RH e não é migrado.

Controle administrativo aplicado em 25/10/2026: a deny policy IAM v2 `rep-p-arp-write-guard`, condicionada a `resource.matchTag('smart-converter-752gf/rep-p-arp', 'protected')`, nega `datastore.googleapis.com/entities.create`, `.update` e `.delete` a `principalSet://goog/public:all`. As únicas exceções são `firebase-app-hosting-compute@…`, escritor legítimo da ARP, e o agente gerenciado `service-787876557774@gcp-sa-firestore…`, necessário à administração do banco. A conta genérica das Functions, o Admin SDK e usuários administrativos não são exceções. O papel `roles/iam.denyAdmin` foi concedido temporariamente no nível da organização, porque o papel não é aceito no projeto, e removido imediatamente após a criação. Não remover papéis de agentes de serviço às cegas.

## Roteiro de restauração (ensaio)

Objetivo do ensaio de 24/10: provar o procedimento de recuperação usando o backup do `coala-rh`, onde a ARP ainda residia antes da separação, sem tocar o banco de produção. A restauração do Firestore cria um **banco novo**; o original não é alterado.

1. Listar backups: `gcloud firestore backups list --location=southamerica-east1 --project=smart-converter-752gf`.
2. Restaurar em banco descartável:
   ```bash
   gcloud firestore databases restore --source-backup=projects/smart-converter-752gf/locations/southamerica-east1/backups/<ID> \
     --destination-database=coala-rh-restore-ensaio --project=smart-converter-752gf
   ```
3. Comparar contagens de `repP_events`, `repP_receipts`, `repP_attempts` e `repP_establishments` entre o banco restaurado e a origem na data do backup. Conferir `lastNsr` por estabelecimento e a cadeia de hash (`verifyRepPChain`). Antes da primeira batida real, essas coleções estarão vazias: o ensaio prova o procedimento, não o volume.
4. Registrar duração, contagens e divergências no registro do chamado.
5. Excluir o banco de ensaio **no mesmo dia** (ele contém os mesmos dados pessoais e herda o IAM do projeto). Antes, conferir o nome literal com `gcloud firestore databases describe --database=coala-rh-restore-ensaio --project=smart-converter-752gf`; depois executar `gcloud firestore databases delete --database=coala-rh-restore-ensaio --project=smart-converter-752gf` digitando o nome literal, nunca por variável de shell. A proteção contra exclusão do `coala-rh` mitiga, mas não substitui essa conferência. Registrar a remoção.
6. Repetir com PITR (**não validado** até executar): ler pelo Admin SDK um documento com `readTime` de um instante dos últimos 7 dias (transação somente leitura com `readTime`) ou clonar o banco no ponto do tempo para outro banco descartável, e conferir o valor recuperado com o histórico.

### Ensaio executado em 24/10/2026

- origem: backup `8435a135-5924-481c-b53e-f87c77465cac`, snapshot de `23/10/2026 23:28:18 UTC`;
- destino descartável: `coala-rh-restore-ensaio-20261024`;
- duração: 11 min 47 s, de `12:06:35` a `12:18:22 UTC`;
- contagens idênticas na origem e na restauração: `employees=38`; `dp_absenceRequests=0`; `repP_establishments=0`; `repP_events=0`; `repP_receipts=0`; `repP_attempts=0`; nenhum cabeçalho REP-P, como esperado antes da primeira batida;
- o banco descartável teve o nome literal conferido, sua proteção contra exclusão foi removida somente nele e a exclusão terminou em `24/10/2026 12:20:09 UTC`;
- `coala-rh` permaneceu intacto, com PITR e proteção contra exclusão; o backup de origem permanece preservado até `29/01/2027`.

O ensaio comprova a restauração integral do backup e o procedimento seguro. A prova específica de PITR por instante continua sendo um exercício distinto.

### Ensaio do banco dedicado executado em 25/10/2026

- origem: primeiro backup disponível do `coala-rep-p`, `1812b508-cce6-4ed0-9720-5fc313e16bbd`, fotografia de `25/10/2026 09:49:41 UTC`;
- destino literal descartável: `coala-rep-p-restore-20261025`;
- restauração concluída em estado `SUCCESSFUL`, preservando a proteção contra exclusão durante a conferência;
- comparação por lista fechada retornou resultado idêntico para `repP_establishments`, `repP_employees`, `repP_events`, `repP_attempts`, `repP_exportAudit`, `repP_receipts`, `repP_offlinePermits`, `repP_locationPolicies`, `repP_locationEvidence`, `repP_locationReviews`, `repP_competenceFences`, `repP_availabilityIncidents` e `repP_availabilityStates`;
- todas as contagens eram zero e não havia cabeçalho/NSR, como esperado antes da primeira batida oficial; isso prova o procedimento e a restauração integral da fotografia vazia, não uma cadeia fiscal populada;
- após a comparação, a proteção foi desativada **somente** no destino literal e o banco descartável foi excluído em `25/10/2026 15:17:48 UTC`;
- `coala-rep-p` e o backup de origem permaneceram intactos.

O primeiro ensaio validou `coala-rh` antes da separação; este segundo ensaio fecha a prova inicial do banco dedicado. Repetir com dados populados faz parte da rotina periódica de recuperação, não é condição para criar a primeira marcação.

## Arquivo fiscal imutável

Criado em 24/10/2026 o bucket dedicado `gs://smart-converter-752gf-rep-p-fiscal`, região `southamerica-east1`, classe `STANDARD`, acesso uniforme e prevenção de acesso público. A retenção é por objeto e o backend exige modo `Locked` por 20 anos.

Uma amostra sintética neutra foi gravada em `homologation/2026-10-24/retention-proof-ecpf-synthetic.pdf`, geração `1792843514222718`, com retenção travada até `25/10/2046 00:00:00 UTC`. SHA-256: `9f8e4fc4d826ac97e70e063e423486443c3f363e744b2938b41370f4d1d70d2d`. Por ser `Locked`, esse objeto não pode ser apagado nem ter o prazo reduzido antes dessa data.

O papel customizado `repPFiscalArtifactWriter` concede ao runtime do App Hosting somente `storage.buckets.get`, `storage.objects.create` e `storage.objects.get` nesse bucket. A política foi conferida; não foi concedido `iam.serviceAccountTokenCreator` apenas para simular o runtime por impersonação.
