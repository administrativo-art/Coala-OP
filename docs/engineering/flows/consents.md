# Consentimento de imagem e voz: inventário de uso

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página por colaborador](../../../src/app/dashboard/documents/consents/%5BemployeeId%5D/page.tsx) mostra decisão vigente, versão/hash do termo e usos operacionais. Ela exige `consents.view` na interface e chama [`GET /api/hr/consents/image-voice/[employeeId]`](../../../src/app/api/hr/consents/image-voice/%5BemployeeId%5D/route.ts). A rota repete a autorização com `assertFormalizationAccess`, resolve o vínculo canônico da pessoa por [`resolvePersonLink`](../../../src/features/hr/lib/person-link.server.ts), lê o documento do colaborador no banco RH e normaliza `consentimento_imagem_voz` via [`normalizeImageVoiceConsent`](../../../src/features/hr/consents/image-voice-consent.ts).

Quem tem `consents.manage` pode registrar uma publicação (`register_usage`) apenas quando o consentimento exibido está `granted`, ou marcar uso como retirado (`mark_removed`). [`POST` da mesma rota](../../../src/app/api/hr/consents/image-voice/%5BemployeeId%5D/route.ts) confere a permissão no servidor, limpa campos recebidos e aplica [`registerImageVoiceUsage`/`markImageVoiceUsageRemoved`](../../../src/features/hr/consents/image-voice-consent.ts) na transação. Nessa transação, atualiza o colaborador, cria evento em `consentimentos_imagem_voz_historico` e cria `audit_log` no banco RH. A validade da transição precisa ser julgada pela função de domínio; o botão desabilitado na interface não é a garantia de autorização.

## Dados, impacto e verificação

O estado embutido no colaborador inclui decisão, prova, usos e efeito operacional; o histórico e a auditoria registram a ação. Alterações em formato ou status afetam a [formalização RH](../../../src/features/hr/lib/server-access.ts) e qualquer integração que publique imagem/voz. `npm run check` passou na verificação anterior do mapa (2026-09-25). Antes de alterar, localizar origem da concessão e revogação, testar perfil sem `view/manage`, pessoa fora de escopo, registro após revogação, retirada repetida e atomicidade dos três registros. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Complemento do rastreamento: origem e revogação

A [submissão pública da integração](../../../src/app/api/hr/onboarding/public/[token]/route.ts) usa `parseImageVoiceConsentDecision`, valida versão/decisão, resolve a decisão preservada com `resolveSubmittedImageVoiceAuthorization` e cria snapshot do termo. Salva autorização, hash, versão, protocolo, evidências, estado `granted`/`denied` e histórico no processo. A sincronização ao empregado existente é posterior; ver [formulário e documentos](onboarding-public-documents.md). A [ativação](onboarding-activation.md) promove esse estado e histórico ao cadastro RH; não é uma nova concessão tácita.

A [revogação pelo perfil](../../../src/app/api/rh/employee-profile/[employeeId]/image-voice-consent/route.ts) exige `requireUser` e propriedade pelo UID/vínculo RH; perfil de gestor não substitui a condição de titular. Resolve consentimento do empregado ou, como fallback, do processo por ID, empregado ou e-mail. Se já negado/revogado retorna 409. `revokeImageVoiceConsent` calcula novo estado. Um batch RH grava empregado, histórico, espelho no onboarding quando encontrado, histórico do processo, `hrNotifications` para Marketing/Administrativo e `audit_log`; pode migrar o evento inicial ainda ausente. As leituras antecedem o batch, portanto não há bloqueio transacional contra duas revogações simultâneas.

A notificação solicita retirada operacional; não remove automaticamente conteúdo já publicado. Os registros de uso e retirada continuam na API gerencial descrita acima. Testar titular versus terceiro, repetição, fallback e falha entre bancos pertence à verificação integrada seguinte.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
