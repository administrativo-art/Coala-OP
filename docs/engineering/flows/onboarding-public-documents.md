# Integração: formulário público e conferência de documentos

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

O link enviado na [criação da integração](onboarding-non-pj-creation.md) abre o formulário público servido por [`/api/hr/onboarding/public/[token]`](../../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts). `GET` localiza `onboardingProcesses` pelo token, confere fechamento/expiração e devolve dados apropriados ao formulário. `POST` aplica limite de tentativas em memória, campo isca, tamanho de payload e sanitização; confere novamente link e estado.

1. Para vínculo não PJ, o `POST` valida identidade, contato, respostas, aviso de privacidade, ciência de alergias e decisão opcional de imagem/voz. Nome e CPF ficam bloqueados após o primeiro envio salvo liberação explícita do RH. Documentos só podem ser reenviados quando pendentes ou reprovados; o servidor aceita URLs do domínio Firebase Storage e associa hash/extração disponível. Grava respostas, documentos, snapshots/aceites, histórico de consentimento e auditoria; move `documents` para `document_review` e status `reviewing_documents` quando aplicável. [Fonte](../../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts).
2. Para PJ, o mesmo `POST` usa validação própria de representante, poderes, banco e nota fiscal, exige aviso de privacidade e documentos obrigatórios. Atualiza a trilha PJ, fecha o link e move para conferência. [Fonte](../../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts).
3. O RH revisa por [`PATCH /api/hr/onboarding/[id]`](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts), que exige `documents.review` para `document_status`, revisão em lote e confirmação/correção de campos extraídos. Aprovar, reprovar ou pedir revisão exige `currentStage: document_review` e arquivo auditável; reprovação em lote exige motivo. Outras ações da rota exigem `onboarding.manage`. A [interface de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) envia essas ações.
4. A rota de revisão grava `documents` no processo e auditoria da ação. A transição `advance_stage` só permite sair da conferência para contador; etapas posteriores verificam ficha do contador, assinatura, validação final e integrações antes de avançar. [Fonte](../../../src/app/api/hr/onboarding/%5Bid%5D/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `onboardingProcesses` no banco RH | Leitura por token, respostas, documentos, estágio e revisão | Link público com validade; `documents.review` para conferência. |
| Subcoleções `audit`, histórico de consentimento e snapshots | Registro de acesso, submissão e aceite | Escritas na rota pública; aprovação no RH gera auditoria. |
| Firebase Storage e extrações documentais | URLs, hashes e análises | Esta rota recebe referências; verificar o upload físico e regras de Storage separadamente. |
| Dados de colaborador existente | Sincronização posterior de privacidade/consentimento | Tentativa após submissão não PJ; falha é capturada e registrada. |

**Ponto de atenção observado:** o `GET` público registra `PUBLIC_LINK_ACCESSED` na subcoleção de auditoria. Isso é uma escrita durante leitura; avaliar o contrato de auditoria antes de aplicar a orientação geral de GET sem efeitos de [`AGENTS.md`](../../../AGENTS.md). **Inferência de impacto:** processo, snapshots, histórico, auditoria e Storage não formam uma transação única, então falhas parciais precisam ser tratadas ao alterar a submissão.

## Verificação e limites

Os [testes de integração de RH](../../../tests/unit/hr-onboarding) cobrem partes da política documental e de privacidade; conferir casos concretos antes de atribuir cobertura ao `POST` público, à revisão ou a uploads. Para mudança, verificar link expirado/fechado, identidade corrigida, documentos rejeitados, conteúdo sensível, consentimento, arquivo auditável e transição ao contador. O upload físico está detalhado abaixo; validação das regras de Storage e testes integrados permanecem pendentes.

## Upload físico e fronteira de autorização

[`POST /api/hr/upload`](../../../src/app/api/hr/upload/route.ts) é a entrada física. Para integração pública, resolve o token, rejeita processo fechado/cancelado/concluído ou link expirado e restringe substituição a documentos pendentes/reprovados. Aplica campo isca e limites em memória; aceita até 10 MB de PDF/JPEG/PNG com conferência dos bytes iniciais, rejeita PDF criptografado e restringe foto a JPEG/PNG. Há também ramos interno, vaga e banco de talentos; ver [recrutamento](recruitment.md).

Salva em `hr/onboarding/{token}/...` com nome único e token de download, e depois registra hash/extração e auditoria. A submissão pública do processo associa a referência posteriormente. Inferência: arquivo pode existir sem submissão concluída; Storage, extração, processo e auditoria não têm commit único. O handler usa acesso administrativo, portanto sua autorização precisa ser conferida diretamente, além das regras para acessos de cliente. Testes de expiração, reenvio, conteúdo real, URL/token de download, falha parcial e regras de Storage continuam pendentes; a localização do upload está concluída.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
