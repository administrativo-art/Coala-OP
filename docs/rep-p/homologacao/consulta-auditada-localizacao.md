# Consulta auditada de localização na candidata local

Implementação em 27/10/2026, branch `test/rep-p-availability-location`. Serviço, API, painel e configuração de índices/TTL preparados localmente. Nenhuma permissão foi concedida a um usuário real; nenhuma coleta foi ativada e nenhum recurso foi publicado nesta etapa.

## Comportamento entregue

O titular consulta os próprios dados na tela de ponto. Na conferência de outra pessoa, o painel exige a nova permissão `dp.timeRecording.readLocation`; o servidor exige também `dp.view` e o escopo da unidade de execução. A concessão começa falsa para todos os perfis, inclusive o administrador padrão. Os builders de permissão servidor/cliente usam a concessão expressa do perfil atual para essa exceção administrativa. Perfil antigo continua sem acesso, sem migração automática.

Cada chamada POST delimita pessoa, unidade, dia civil válido e fonte (marcação ou jornada), com até 50 registros e cursor de ID. A consulta traz somente ID, horário, status e coordenadas/precisão. Os filtros reduzem os documentos na consulta ao Firestore. Não há varredura geral, polling, mapa externo ou captura de localização ao abrir o painel.

O motivo é registrado por categoria: solicitação do colaborador, conferência operacional ou atendimento de privacidade; o titular usa `own_data`. Essa declaração não comprova por si a existência de um pedido ou necessidade administrativa: treinamento e supervisão continuam necessários.

Antes da resposta, o servidor grava `repP_locationAccessAudit` no banco REP com ator real, titular, unidade, dia, fonte, motivo e IDs retornados. A auditoria não copia as coordenadas. Falha de escrita impede a resposta. Dados vencidos não são entregues pela consulta comum, mesmo enquanto a exclusão TTL está pendente; o cursor continua avançando sobre a página física. Os originais fiscais e o NSR não são alterados.

## Evidências

| Verificação | Resultado e limite |
| --- | --- |
| APIs reais com tokens do Auth Emulator | 12/12 no arquivo completo, incluindo regressões de exportação e dois novos subtestes de localização; log `location-api-admin-grant.log` |
| Titularidade e escopo | Outro titular, modo suporte e DP sem concessão recusados; pessoa/workspace/unidade/dia isolados; administrador sem grant recusado e com grant aceito |
| Paginação e dados vencidos | Páginas sem repetição; itens vencidos omitidos; campos internos e política não retornados |
| Revogação e auditoria | Remover grant impede próxima consulta com o mesmo token; trilha sem coordenadas; falha da auditoria bloqueia resposta |
| Regras cliente do banco REP | 1/1 no filtro ARP, incluindo leitura/escrita/exclusão da nova auditoria negadas ao cliente; log `location-api-final.log` |
| Interface local com respostas sintéticas | Playwright dirigido 1/1, log `location-ui-final.log`; consulta pessoal, ausência de leitura automática, paginação, vazio, erro e visão administrativa sem grant |
| Tipo, estilo e segurança | `npm run typecheck`, ESLint dirigido, contratos de erro/segurança e inventários aprovados; contrato novo sem exceção |

Na primeira execução E2E dirigida, a parte pessoal passou, mas a navegação administrativa excedeu a expectativa de 20 segundos durante carregamento local. O trace mostrou documento de cerca de 22 segundos e chunk de cerca de oito segundos. A espera foi ajustada para 120 segundos, sem mudar comportamento do produto; a asserção de painel ausente passou a ocorrer depois do nome visível, impedindo sucesso antecipado durante loading. A execução final passou em 2,7 minutos. Isso não é medição de desempenho de produção nem teste de GPS.

## Publicação e decisões restantes

Publicar serviço/rota/painel, índices compostos dos bancos REP/RH e TTL da auditoria; conferir IAM do runtime e conceder acesso somente aos perfis nominalmente aprovados. Conferir isolamento e auditoria no destino com cenário autorizado antes de liberar pessoas reais. Essas ações não foram executadas nesta etapa.

A [política interna](../privacidade/politica-interna-localizacao.md), a [comunicação dos atuais](../privacidade/comunicacao-colaboradores-atuais.md) e o [RIPD preparatório](../privacidade/ripd-localizacao.md) mantêm o RH como entrada dos pedidos internos e o canal formal do termo. Permanecem minutas; base legal, necessidade por modalidade, frequência efetiva, justificativa da guarda, eliminação/custódia e risco residual exigem decisão responsável. Termo v5 preservado.

O [plano da monitoração](monitoracao-publicada.md) distingue a sonda disponível dos componentes ainda não publicados/localizados. Galaxy e ensaio publicado continuam separados dos resultados acima. A revisão obrigatória fica no registro privado do chamado e deve considerar este incremento antes do commit.
