# Retenção do estado privado de continuação

`privacyPersonCursorStates` existe somente no banco principal `coala`. Guarda posição de leitura, titular e atores real/efetivo, jamais é emitido como linha do inventário ou acessível pelo SDK cliente. A validade lógica de cada token é de 15 minutos; token expirado ou com vínculo divergente é recusado imediatamente. Firestore TTL é eventual e não promete expurgo físico no instante da expiração.

A configuração versionada em `firestore.indexes.json` habilita TTL somente em `privacyPersonCursorStates.expiresAt`. O estado não depende de memória de instância Cloud Run. A implantação do campo TTL precisa ocorrer junto da funcionalidade; não executar escrita/configuração real neste chamado sem o fluxo de publicação autorizado. Comandos específicos preparados para conferência pelo responsável:

```sh
gcloud firestore fields ttls update expiresAt --collection-group=privacyPersonCursorStates --database=coala --project=smart-converter-752gf --enable-ttl
gcloud firestore fields ttls describe expiresAt --collection-group=privacyPersonCursorStates --database=coala --project=smart-converter-752gf
```

Nenhum comando de implantação desta cache foi executado em projeto real. A regra cliente explícita nega leitura/escrita da cache. Somente o protocolo servidor lê um token por ID randômico; cada página cria no máximo um próximo estado. Até 100 leituras de fonte e 5 consultas por página, mais o pré-voo de identidade limitado e uma leitura do token. Consulta de catálogo não cria estado. Permissões e escopo são reavaliados em cada requisição.

Falha da origem ou perda da resposta permite repetir o mesmo token até sua expiração, preservados os vínculos e a autorização atual. A posição ordenada permanece utilizável mesmo quando o registro previamente lido foi removido. Páginas vazias com continuação não representam fim: o painel mantém **Carregar mais referências**. Estado bruto, IDs recusados e posições não saem em JSON nem no token; o token opaco não incorpora dados da fonte.
