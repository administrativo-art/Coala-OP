# Acesso, privacidade e entradas compartilhadas

Complemento transversal da etapa 8, em 2026-09-26. Estes percursos não dependem de uma página ativa do dashboard; não acrescentam automaticamente grupos à matriz de 53 grupos. Estado: leitura estática das fronteiras abaixo, sem homologação dos provedores.

## Autenticação e primeiro acesso

Entradas: [login](../../src/app/login/page.tsx), [recuperação](../../src/app/api/auth/forgot-password/route.ts), [primeiro acesso](../../src/app/api/auth/first-access/%5Btoken%5D/route.ts) e [serviço do link](../../src/lib/first-access-links.ts). A recuperação responde genericamente para e-mails ausentes ou desconhecidos. Antes de consultar Auth/enviar e-mail, reserva tentativa em transação em `passwordResetRateLimits`, por hash do e-mail: intervalo mínimo de 60 segundos, no máximo cinco na janela de uma hora. Em seguida usa Auth e Resend e registra `emailCommunications`; essas operações não formam transação global. Limitação observada: o limite é por endereço, não comprova proteção global contra abuso distribuído.

GET de primeiro acesso consulta o estado do token; POST valida senha e pré-requisito de acesso PDV antes de `consumeFirstAccessLink`. Consumo, mudança de senha e projeções em outros bancos precisam ser analisados no serviço; não inferir atomicidade da existência de token. A ativação e seus efeitos distribuídos estão no [guia de ativação](flows/onboarding-activation.md). Não presumir a opção de persistência ou os testes de recuperação do worktree anterior: não estão nesta base.

`/api/auth/last-login`, `/api/auth/password-changed`, `/api/profile-compliance`, `/api/client/bootstrap` e `/api/hr/login-access` são fronteiras compartilhadas de sessão, cadastro e acesso: consultar seus handlers individuais no [inventário](surface-inventory.md), além de [pessoas e acesso](flows/people-access.md). Ter uma sessão não certifica escopo de unidade ou permissão de cada operação.

## Programação exclusiva do Instagram

[`/instagram-programacao`](../../src/app/instagram-programacao/page.tsx) fica fora do dashboard e não possui entrada no menu. A ausência na navegação não concede sigilo: as APIs de programação e biblioteca exigem Firebase Auth, resolvem usuário/perfil no servidor e chamam `requireInstagramSchedulerAccess`. Com `INSTAGRAM_SCHEDULER_ALLOWED_EMAILS` configurado, a lista é restrita aos e-mails informados; sem configuração, somente administrador padrão passa. As coleções `instagramScheduledPosts` e `instagramMediaLibrary` ficam no banco nomeado `coala-signage`, usado pelo Marketing, e negam acesso direto do cliente; o prefixo `storage/instagram` mantém a mesma negação no bucket principal.

O retorno depois do login aceita apenas caminho interno validado por [`resolveSafeReturnPath`](../../src/lib/safe-return-path.ts). As respostas omitem URLs de entrega, caminhos de objeto, tokens, leases e identificadores internos dos contêineres. Cada prévia revalida sessão, workspace, documento e prefixo esperado antes de ler o Storage. A grade publicada expõe ao cliente somente metadados e URLs temporárias de mídia que a própria Meta retorna para exibição, nunca o token usado na consulta. Segredo, mutações e estados de publicação estão descritos no [fluxo do Instagram](flows/instagram-publishing.md).

## Arquivos de conciliação Pix da Stone

[`POST /api/jobs/stone-pix/request`](../../src/app/api/jobs/stone-pix/request/route.ts) é uma entrada exclusiva de máquina, protegida pelo mesmo segredo do sincronizador de carteira Stone; não aceita sessão de usuário como substituto. A credencial Basic da Stone permanece no servidor e nunca é retornada ao cliente. O transporte envia somente documento e data no caminho oficial V2 e não registra cabeçalhos ou corpo externo.

O [webhook Stone](../../src/app/api/webhooks/stone/conciliation/route.ts) exige segredo próprio, aceita payload limitado, valida a URL de download e grava apenas hash da URL da notificação. Arquivos, pedidos e linhas ficam no banco financeiro e são lidos pela comparação autorizada; a tela recebe status, cobertura, contagens e casos derivados, sem credenciais nem URL assinada. A retenção desses arquivos ainda não possui rotina TTL documentada e deve ser definida antes de ampliar o histórico.

## Pedidos de privacidade e incidentes

As [rotas de pedidos](../../src/app/api/privacy/requests/route.ts) e [incidentes](../../src/app/api/privacy/incidents/route.ts) usam [requirePrivacyUser](../../src/app/api/privacy/_lib.ts). O helper aceita administrador ou permissões como `settings.view`, gestão de usuários/perfis ou edição/desligamento de colaboradores. Isso descreve a política implementada, não aprova a amplitude de `settings.view` para alterações sensíveis.

Dados: `privacyRequests` e `securityIncidents` no principal. GET filtra `workspace_id` e limita a 100 documentos. POST valida campos, grava registro e chama auditoria depois. PATCH de [pedido](../../src/app/api/privacy/requests/%5Bid%5D/route.ts) e [incidente](../../src/app/api/privacy/incidents/%5Bid%5D/route.ts) lê estado, atualiza e audita em etapas separadas. Falha na auditoria e atualização concorrente permanecem riscos a reproduzir. Enum com fallback não significa máquina de estados validada. Retenção declarada no registro não prova a execução de uma política TTL no ambiente implantado.

## Auditoria, reparo e uploads operacionais

- [POST de auditoria](../../src/app/api/audit/log/route.ts) deriva ator e workspace da sessão, limita profundidade/tamanho de metadados e aceita `module`/`action` fornecidos pelo cliente. Tratar esses eventos como declarações do cliente; não como comprovação de commit de negócio. O catch ainda devolve `error.message` e merece adequação ao contrato central. [Erros de cliente](../../src/app/api/observability/client-errors/route.ts) têm contrato distinto: consultar [observabilidade](observability.md).
- [Reparo de recibos](../../src/app/api/admin/fix-receipts/route.ts) exige administrador padrão, busca pedidos confirmados sem limite global, verifica recibo com `limit(1)` e cria ID aleatório em batch. Consulta e criação não são transacionais; chamadas concorrentes podem criar dois recibos. O cálculo do total pode ser gravado antes do recibo. Achado estático; a rota não foi executada nesta auditoria.
- [Upload operacional](../../src/app/api/uploads/operations/route.ts) distingue assinatura de reposição, documento de despacho e comprovante de compra; valida tamanho e assinatura inicial do arquivo, exige permissão e existência do alvo. Reposição confere unidades; o ramo de recibo não compara explicitamente seu workspace ao contexto. Storage e vínculo posterior são operações separadas. O upload patrimonial tem contrato próprio; não transferir garantias entre as duas rotas.

Os achados e os próximos testes necessários estão na [auditoria ampliada](surface-audit.md). Nenhuma dessas rotas foi chamada contra produção.
