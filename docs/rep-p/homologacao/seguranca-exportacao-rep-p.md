# Segurança das exportações do REP-P

Revisão local autorizada pelo programador após pedir que cada colaborador exporte somente seus próprios dados. Os ensaios usam projeto `demo-coala-repository`, Auth/Firestore locais e contas/arquivos fictícios. Não houve escrita em produção.

## Falhas encontradas e corrigidas na candidata

1. **Sessão antiga após incremento de versão:** o token da versão zero ainda exportava quando `users.sessionVersion` já era um. `verifyAuthWithUser` agora compara a versão do token e do cadastro. Ausência equivale a zero para compatibilidade legada; valor inválido ou diferença falha com 401. A correção usa a leitura de usuário já existente, sem leitura adicional.
2. **Privilégio administrativo antigo:** `auth-server` aceitava o claim administrativo antigo mesmo após rebaixamento do perfil. O perfil atual do cadastro passa a ser autoritativo. Remover, zerar ou trocar `users.profileId` não recupera o perfil gravado num token antigo. O contrato legado de identidade administrativa sem perfil no próprio token foi preservado.
3. **Exceção de exportação em Visualizar como:** o modo de suporte antes selecionava também o titular do ZIP/PDF pessoal. GET do ZIP, GET do comprovante e GET do espelho PDF agora usam `requireAuthenticatedUser`, conservando a identidade real. POST de reemissão mantém `requireUser` e a restrição de escrita do modo de suporte.

As duas primeiras falhas foram reproduzidas com resposta 200 antes da correção, onde a expectativa era 401/403. A terceira era uma exceção do contrato de visualização; foi reproduzida e fechada para atender ao pedido de exportação pessoal literal. Não se alega acesso indevido observado em produção.

## Matriz de acesso verificada

| Operação | Resultado do ensaio |
| --- | --- |
| Colaborador A baixa seu comprovante/ZIP | 200; contém somente o arquivo de A |
| A tenta comprovante de B, outro workspace ou ID inexistente | 404 indistinto; não entrega bytes nem reemite |
| A tenta trocar titular por query, header ou cookie de suporte | Campos desconhecidos recusados; identidade e conteúdo continuam de A |
| Identidade de suporte usa Visualizar como A para exportar pessoalmente | ZIP não contém A; comprovante A retorna 404 |
| Perfil pessoal tenta AFD/AEJ/opções fiscais | 403 |
| Gestor de ponto limitado a uma unidade tenta extração fiscal global | 403; gestão fiscal exige também escopo global |
| Gestor global autorizado consulta opções fiscais | 200 |
| Colaborador pede espelho de outra pessoa | 403 |
| DP autorizado consulta pessoa da sua unidade | 200 e auditoria de acesso |
| DP pede pessoa fora da unidade | 404 |
| Conta sem login, inativa ou desabilitada | Sem exportação; 401/403 conforme contrato |
| Token com versão antiga, inclusive de gestor | 401; nova autenticação com versão atual volta a permitir a operação |
| Token administrativo antigo após rebaixamento, retirada ou troca do perfil | 403 |
| Monitor sem segredo, segredo errado, origem errada ou payload inválido | 401/403/400; notificação válida com coleta oficial desligada não consome NSR |

A consulta administrativa autorizada não é uma exportação pessoal: permanece sujeita às permissões de fechamento/consulta e ao escopo de unidade. O espelho de outra pessoa exige `employeeUid` explícito e autorização do serviço. Visualizar como continua disponível para as demais leituras de suporte pelo contrato existente; não transfere a titularidade das três rotas de PDF/ZIP alteradas.

## Evidências e alcance

- `dp-rep-p-api-security.test.mjs`: 10 testes, incluindo agregador, aprovados.
- Regressão de permissões de privacidade, junto ao arquivo anterior: **11/11** no emulador.
- Contratos de rota + versões de sessão + ciclo de identidade: **15/15**.
- AFD na meia-noite do fuso de execução, paginação e união das partes; marcação e evento do monitor concorrentes com reenvios: arquivo `dp-rep-p.test.mjs` **4/4**. Não houve omissão, duplicação ou colisão de NSR nos cenários.
- `npm run check:security-contracts`: zero violações, inventário atual.
- ESLint dirigido: aprovado. Typecheck (`typegen` + `tsc --noEmit`): aprovado, exit 0.

O novo teste API integra o runner padrão no segmento Node sem condição RSC, usando o helper de `server-only` já existente no repositório. A primeira tentativa com React Server causou erro de harness, sem execução do teste; o método da consulta administrativa foi alinhado ao POST auditado real e conta inativa continua retornando o 403 previsto. Nenhuma dessas adaptações suprimiu as regressões reais de sessão/perfil/exportação.

Os testes de rota invocam os handlers e enforcers reais com tokens emitidos pelo Auth Emulator. A inspeção de regras da ARP/jornada da rodada anterior continua válida; não substituímos validação de servidor por ocultação de botões. Não houve uso de navegador nem teste de penetração externo.

## Compatibilidade e conferência do destino

A alteração de autorização é compartilhada por APIs que usam `verifyAuthWithUser`/`requireUser`. Cadastros sem perfil canônico não recuperam permissões a partir do token. Foi feita consulta somente de metadados, limitada a 201 usuários: retornou **16**, sem truncamento, com **zero** cadastros sem `profileId`, **seis** referências de perfil e **zero** perfis referenciados ausentes. Não foram impressos nomes, e-mails, tokens ou dados pessoais; nenhuma migração foi necessária para esse estado.

O suporte a sessão legada sem versão permanece limitado ao cadastro com versão zero. As rotas HTTP alteradas recusam versões malformadas; isso não certifica todas as outras superfícies de autenticação do produto, incluindo callable Functions.

## Limites da entrega

Os ensaios e correções não publicam código, não concedem permissões, não ligam coleta fiscal/localização; a consulta auditada de coordenadas foi implementada em incremento posterior, com revisão própria descrita no guia REP. Doc Brown reabriu e concluiu a revisão desta ampliação como **CONFORME para commit**, sem achado bloqueante remanescente neste escopo; veredito registrado no chamado. CI remoto continua dependendo de commit/push/PR autorizados.

Logs privados: `.ai-work/development-technology/rep-p-availability-location/`, especialmente `security-boundaries-retest.log`, `stale-admin-reproduction.log`, `view-as-export-reproduction.log`, `security-exports-final.log`, `security-unit-final.log` e `security-contracts-final.log`.
