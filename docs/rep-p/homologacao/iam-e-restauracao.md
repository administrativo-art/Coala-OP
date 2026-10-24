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

Resta um controle administrativo: as contas genéricas de Functions e do Admin SDK ainda recebem permissões amplas no projeto. Foi preparada uma negação condicionada à tag para `datastore.entities.*`, preservando o runtime do App Hosting como escritor legítimo, mas a criação foi recusada porque `administrativo@coalashakes.com` não possui `iam.googleapis.com/denypolicies.create`. É necessário um administrador com `roles/iam.denyAdmin` criar essa política, ou conceder temporariamente esse papel para a aplicação controlada. Não remover `firebase.admin` nem papéis de agente de serviço às cegas.

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

O primeiro ensaio acima validou `coala-rh`, antes da separação. Após a publicação e antes da primeira batida oficial, executar também uma restauração do primeiro backup disponível de `coala-rep-p`; até haver dados, a prova limita-se à criação, proteção, PITR e agendamento do backup.

## Arquivo fiscal imutável

Criado em 24/10/2026 o bucket dedicado `gs://smart-converter-752gf-rep-p-fiscal`, região `southamerica-east1`, classe `STANDARD`, acesso uniforme e prevenção de acesso público. A retenção é por objeto e o backend exige modo `Locked` por 20 anos.

Uma amostra sintética neutra foi gravada em `homologation/2026-10-24/retention-proof-ecpf-synthetic.pdf`, geração `1792843514222718`, com retenção travada até `25/10/2046 00:00:00 UTC`. SHA-256: `9f8e4fc4d826ac97e70e063e423486443c3f363e744b2938b41370f4d1d70d2d`. Por ser `Locked`, esse objeto não pode ser apagado nem ter o prazo reduzido antes dessa data.

O papel customizado `repPFiscalArtifactWriter` concede ao runtime do App Hosting somente `storage.buckets.get`, `storage.objects.create` e `storage.objects.get` nesse bucket. A política foi conferida; não foi concedido `iam.serviceAccountTokenCreator` apenas para simular o runtime por impersonação.
