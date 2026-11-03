# Plano — Um arquivo assinado, múltiplas referências

Data: 02/11/2026. Decisão: o PDF completo enviado retorna da assinatura como um único original assinado. Acervo, processo e histórico devem referenciar esse objeto; a organização em pastas não cria cópias físicas.

## Situação verificada

A promoção admissional legada copiava o PDF completo para cada componente. A primeira correção unificou a identidade do kit, mas ainda copiava a recepção para outro objeto permanente. Assinaturas individuais promovidas depois da ativação também copiavam. Assinatura avulsa gerada, férias e fechamento do ponto possuem caminhos que permitem compartilhar a referência; importações históricas podem conter duplicatas independentes. O levantamento pontual paginado está no registro privado do chamado, sem dados pessoais no repositório.

## Implementação

1. Reutilizar `signedStoragePath` no registro do kit e nas assinaturas individuais, validando os bytes pelo hash antes de arquivar. Não reescrever os registros antigos nesta mudança.
2. Preservar o original assinado quando um gestor remove sua entrada do Acervo. Marcar o registro como removido e gravar auditoria atomicamente; a trilha de assinatura continua referenciando o arquivo. Publicação e acesso mantêm suas regras, incluindo recusa de registros removidos.
3. Cobrir assinatura antes/depois da ativação, retomada, hash divergente, ausência de cópia física e remoção autorizada/indevida em emuladores. Não enviar documentos ao provedor real.
4. Revisão Doc Brown antes do commit, CI e promoção main → production → App Hosting, com confirmação de SHA, rollout e tráfego.

## Limpeza histórica — pendente, operação separada

Autorização posterior do programador em 02/11/2026: organizar os documentos e remover as cópias, concluindo esta frente antes de iniciar documentação global ou outra trilha. A limpeza continua sendo uma operação auditada própria, posterior à validação do código e ao pré-voo de referências, hashes, acesso e recuperação. Não autoriza fundir registros de pessoas diferentes por semelhança ou apagar artefatos distintos.

Não excluir objetos por igualdade de nome ou apenas por haver múltiplos registros. Para cada candidato: comparar conteúdo/tamanho, confirmar assinatura/titular/processo, localizar todas as referências (incluindo workflows, processos e importações), escolher objeto canônico e preparar backup e rollback. Consolidar referências com auditoria e invariantes; somente depois de revalidar consumidores, retenção, acesso e autorização específica, remover cópias físicas redundantes. Igualdade de conteúdo entre pessoas ou eventos não permite fundir seus registros.

Uploads da coleta admissional e suas versões exigem análise própria de tokens, acesso e ciclo de vida; não são alterados nesta correção dos assinados. PDF anterior à assinatura, PDF assinado, DOCX e anexos de auditoria são artefatos distintos quando os bytes/funções diferem. A proteção temporária contra exclusão do provedor não é deduplicação do aplicativo.

## Contratos legados e pendências

A API legada de employee-documents mantém autenticação de gestão e unidade. A exceção temporária explícita em security-contract-exceptions expira em 16/11/2026; migração integral de GET/POST/PATCH/DELETE para secureRoute continua pendente e não é substituída pela proteção física do assinado. Nenhuma permissão nova foi criada. A limpeza real só será executada após o pré-voo e a revisão próprios, com a autorização posterior registrada acima.

Estado em 02/11/2026: implementação de armazenamento revisada por Doc Brown, testes dirigidos e integração em emuladores aprovados; publicação e limpeza histórica em andamento. Os ajustes visuais e as instruções/catálogo globais ficam em entregas sequenciais posteriores, sem alterações de patrimônio neste worktree.
