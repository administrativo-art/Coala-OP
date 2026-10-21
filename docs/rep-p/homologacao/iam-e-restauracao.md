# IAM e restauração da ARP

## Inventário IAM

Levantado por leitura da política do projeto `smart-converter-752gf` em 18/10/2026 (fotografia; refazer na revisão). Logs de auditoria de acesso a dados do Firestore não foram avaliados. Lista quem consegue escrever no Firestore (e, portanto, nas coleções `repP_*` do `coala-rh`); as regras deny-all não se aplicam ao Admin SDK.

| Principal | Papel | Uso | Avaliação |
| --- | --- | --- | --- |
| `firebase-app-hosting-compute@…` | `firebase.sdkAdminServiceAgent`, `firebaseapphosting.computeRunner` | App Coala One (único escritor legítimo da ARP) | Necessário |
| `787876557774-compute@developer…` | `firebase.admin` | Conta padrão das Cloud Functions de 2ª geração | **Achado:** qualquer função alcança a ARP. Recomendar conta dedicada com papéis mínimos por função |
| `787876557774@cloudservices…` | `editor` | Agente do Google APIs | Padrão do Google; manter |
| `firebase-adminsdk-fbsvc@…` | `firebase.sdkAdminServiceAgent` | Admin SDK do Firebase | Conferir se há chave exportada em uso; preferir nenhuma |
| `service-…@gcp-sa-firestore…` | `firestore.serviceAgent` | Agente do Firestore (backup/PITR) | Padrão; manter |
| usuário administrativo `ad…@coalashakes.com` | `owner` | Administração | Usar com MFA; registrar ações sobre `coala-rh` |

Controles em código: `firestore.rh.rules` nega `repP_*` a clientes e o teste `dp-rep-p-arp-deletion-guard` impede exclusão e enumeração de coleções no código. A revisão do IAM deve terminar com decisão registrada sobre a conta das Functions.

## Roteiro de restauração (ensaio)

Objetivo: provar que um backup do `coala-rh` recupera a ARP íntegra, sem tocar o banco de produção. A restauração do Firestore cria um **banco novo**; o original não é alterado. Executar com autorização do programador.

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

Retenção longa trancada (anos) continua pendente: o backup do Firestore guarda no máximo 14 semanas. Prever exportação periódica para bucket com bloqueio de retenção, conforme a resposta do advogado sobre o prazo mínimo legal.
