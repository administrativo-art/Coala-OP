# Chamado — correção do modal de área da unidade

## Identificação

- Data: 06/11/2026
- Coordenação: Codex/TARS
- Branch/worktree: `fix/modal-area-unidade-20261106`, `/Users/imated/Coala Sistemas/Coala-OP-modal-area-unidade`
- Base: `d6fbf7c0` (`origin/main`)

## Objetivo e evidência

- Corrigir o modal publicado após reprodução autorizada no Comet, sem salvar dados.
- Observado: o endereço oficial era apenas exibido em cartão separado; o mapa sem área abria no centro padrão de São Luís; a busca movia o pino, mas mantinha ambiguidade entre texto pesquisado, endereço cadastrado e resultado selecionado.
- Decisão do programador: deve existir um único endereço e o modal precisa seguir o design do sistema.

## Alterações

- A busca passa a ser o único campo de endereço e nasce preenchida com o endereço oficial.
- O endereço oficial é geocodificado para posicionar o mapa quando ainda não há área.
- Seleção, clique e arraste atualizam o mesmo endereço; removido o cartão duplicado.
- Respostas antigas de busca/geocodificação são invalidadas; o salvamento fica bloqueado enquanto endereço e pino não correspondem.
- A edição só é oferecida a quem pode salvar endereço e área juntos, evitando dois locais efetivos.
- Modal usa `DialogContent`, `DialogHeader` e `DialogFooter` padrão, com somente o corpo rolável e ações fixas.
- Documentação atualizada e teste de contrato acrescentado.

## Verificação

- ESLint dirigido: verde.
- 6 testes unitários/contrato: verdes.
- `check-engineering-docs.py`: verde.
- `git diff --check`: verde.
- Revisão Doc Brown: conforme para commit; bloqueadores de concorrência, sincronização e padrão visual encerrados.
- Produção: nenhuma escrita realizada durante a reprodução.

## Uso do mapa

- Categoria: correção de regressão visual/funcional em fluxo REP-P.
- Fontes: `system-map.md` reaproveitado do chamado anterior, `time-recording-geolocation.md`, componentes do modal e mapa.
- Telemetria: indisponível.
