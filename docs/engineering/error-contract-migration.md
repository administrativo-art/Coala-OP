# Inventário e migração do contrato de erros

## Estado caracterizado em 26/08/2026 e revalidado em 27/08/2026

O inventário foi produzido com buscas locais, sem consultar produção. Ele representa o checkout atual e inclui dívida histórica e alterações ainda não commitadas.

| Categoria | Ocorrências observadas | Distribuição principal | Proteção atual |
|---|---:|---|---|
| `error.message` ou equivalente em APIs | 230 linhas | financeiro 50; RH 45; auth 3; jobs 3; integrações 2; webhooks 2; outros 125 | baseline do ratchet |
| `console.error`/`console.warn` | 375 linhas | componentes 177; APIs 50; features 32; scripts 31; Functions 27; hooks 18; lib 15; outros 25 | baseline do ratchet |
| `catch {}` vazio | 3 linhas | requer análise individual | inventário, sem migração em massa |
| catches que retornam `null` | 142 linhas | autenticação, carregamentos opcionais e fallbacks misturados | inventário, sem classificação automática |
| ausência de `requestId`/contrato central | maioria das 287 rotas | transversal | wrapper disponível; quatro pilotos |

As contagens são linhas encontradas por `rg`, não número de bugs. Um `catch` que retorna `null` pode ser fallback intencional ou falha silenciosa; a causa precisa ser caracterizada antes de qualquer mudança.

## Mecanismos de domínio preservados

O checkout já possui mecanismos com finalidade própria, incluindo `lastError` de pagamentos, `cashClosureJobRuns`, `emailCommunications`, `securityIncidents`, logs de sincronização e eventos de onboarding. Eles não foram removidos nem substituídos. A camada técnica pode ser ligada a esses registros por `eventId` quando uma migração de domínio exigir correlação.

## Pilotos migrados

| Superfície | Comportamento anterior | Contrato após o piloto | Compatibilidade observada |
|---|---|---|---|
| `POST /api/products` | 401/403 esperados; falha inesperada escapava para o handler do Next | erros esperados usam códigos estáveis; inesperado retorna 500 seguro com `eventId` e `requestId` | sucesso 201 e autorização preservados |
| `GET /api/financial/cash-deposits/[batchId]` | qualquer falha não textual de permissão virava 400 e podia expor mensagem | 401 autenticação, 403 autorização, 404 ausente e 500 inesperado seguro | o 400 genérico de “não encontrado” foi corrigido para 404 |
| `GET /api/hr/integration-templates/[templateId]/versions/[version]` | catch amplo transformava falha técnica em 403 e expunha mensagem | validação 400, ausente 404, autorização 403 e inesperado 500 seguro | status esperados preservados; falha técnica deixa de fingir autorização |
| `POST /api/jobs/inter/cobrancas/reconcile` | 401 esperado; exceção seguia sem correlação | request/correlation ID, observação estruturada de duração/resultado e falha terminal com eventId | sucesso e 401 preservados |

A rota pública `GET /api/signage/public/[kioskId]` foi caracterizada, mas não migrada. Players podem depender do envelope legado `{ error: string }`, e não há teste do consumidor que autorize trocar esse contrato com segurança. A ausência de migração é uma decisão de compatibilidade, não evidência de segurança end-to-end.

## Prioridade de migração

### P0

- autenticação e recuperação de acesso;
- pagamentos, solicitações de pagamento e webhooks bancários;
- rotas financeiras que hoje retornam mensagem bruta;
- rotas públicas sensíveis e seus consumidores versionados;
- jobs de cobrança, conciliação e sincronização críticos.

### P1

- RH, documentos e onboarding;
- integrações externas de RH, e-mail e assinatura;
- funções importantes sem fallback operacional.

### P2

- componentes e hooks de interface;
- cadastros e módulos restantes;
- scripts operacionais legados, depois de distinguir CLI esperada de incidente.

## Estratégia

1. Caracterizar o status, envelope e consumidor da rota.
2. Converter falhas esperadas em `AppError` com código estável e mensagem segura.
3. Envolver a fronteira com `withApiErrorHandling`.
4. Preservar autorização no servidor e idempotência.
5. Criar teste de regressão do contrato.
6. Reduzir o baseline; nunca aumentá-lo para fazer o CI passar.

## Limitações atuais

- Os testes unitários provam o wrapper e os contratos puros; não executam Firestore nem os serviços dos quatro pilotos.
- O endpoint de ingestão client-side usa rate limit em memória por instância. Ele reduz rajadas, mas não é uma cota distribuída global.
- Eventos do navegador só chegam ao servidor quando existe sessão Firebase válida. Fluxos públicos anônimos ficam limitados ao log estruturado do próprio navegador até existir decisão específica de anti-abuse.
- `release` usa `K_REVISION` ou `GITHUB_SHA` quando presentes e cai para `unknown`. A auditoria confirmou o vínculo App Hosting → revision → build → commit: a revisão do Cloud Run usa o identificador do build, e o recurso de build expõe o commit de origem. A automação dessa consulta para a triagem permanece pendente.
- O baseline por arquivo bloqueia aumento de contagem, mas uma substituição de uma violação antiga por outra no mesmo arquivo pode manter a contagem. A migração progressiva deve reduzir contagens e acrescentar testes por contrato.
