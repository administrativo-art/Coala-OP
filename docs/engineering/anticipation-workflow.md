# Antecipações: vínculo administrativo e consulta guiada

Complementa o piloto `financial-agent-read.md`. A tela Financeiro → Antecipações Stone passa a
usar `/api/financial/agent`, com vínculo oficial e data explícitos. Cadastro e consulta disponíveis
apenas para administrador padrão, no servidor e na página. Nenhuma migração de permissões.

## Escopo entregue

- Cadastro manual na coleção existente `stoneMerchantMappings`, sem criar estrutura paralela.
- Contas do workspace e catálogo legado de unidades, todos paginados (50 + sentinela).
- Justificativa, confirmação visual, revisão otimista e evento de auditoria na mesma transação.
- Bloqueio de sobreposição de vigências, concorrência, referência inválida e colisão entre workspaces.
- Histórico inativo com fim de vigência preservado; nenhum vínculo real inferido ou criado automaticamente.
- O formulário existente de contas passa a gravar workspace no salvamento manual, bloqueando
  reassociação de conta que já declare outro workspace. Contas legadas precisam ser conferidas e
  salvas pelo usuário nesse cadastro; não há backfill automático. As permissões existentes do cadastro
  financeiro permanecem, e o agente continua revalidando a propriedade no servidor.
- Conversa **guiada**, não chat livre: quatro perguntas sobre resumo, taxas, parcelas e vencimentos
  afetados. Parâmetros escolhidos pelo usuário, nunca inferidos de texto. Trocar pergunta reutiliza
  a evidência atual. Atualizar consulta executa nova leitura oficial.
- Fonte, data de coleta, conta vinculada, limites de cobertura, ações e tabela por parcela.
- Arredondamento decimal exato na apresentação; taxas nunca deduzidas novamente do líquido.
- Limites de IA mantidos com a orientação OpenAI Docs: saída estruturada, dados não tratados como
  instruções, sem ferramentas de escrita. https://developers.openai.com/api/docs/guides/agent-builder-safety

## Custo — preflight para consultas manuais

Não há polling ou listener. Abrir cadastro faz três consultas limitadas a 51 documentos cada,
mais até seis leituras de autenticação: máximo conservador 159 leituras. Um exemplo de 5 aberturas/h
× 2 administradores × 8h/dia × 30 dias resulta em até 381.600 leituras/mês. Não é medição real.
Carregar uma página adicional custa até 53 leituras. Catálogo legado de unidades usa paginação
por ID porque os documentos antigos não possuem workspace; referências com workspace diferente
são descartadas e a escrita revalida a propriedade. Não há carregamento em provider global.

Salvar: até 101 vínculos do workspace + documento alvo + duas referências + duas leituras de
autenticação. Transação tem no máximo três tentativas; teto conservador 310 leituras por gravação
em contenção e duas escritas efetivas (vínculo + evento). Exemplo de 20 gravações/mês: até 6.200
leituras e 40 escritas. Consultas ao agente mantêm os limites documentados no piloto.

Unidade está no banco operacional e conta/vínculo no financeiro: não se promete atomicidade entre
bancos. O cadastro revalida referências e a consulta revalida novamente antes de acessar Stone.
Somente editores que respeitam `revision` participam da garantia de concorrência; a frente antiga
de integração deve ser alinhada antes de habilitar outro escritor da mesma coleção.

## Rollout

Código não equivale a publicação. Antes de ativar: CI com instalação limpa, publicação autorizada
do backend/índice e confirmação administrativa dos vínculos reais. Sem isso, o novo fluxo bloqueia
consultas por unidade. O endpoint técnico anterior por StoneCode continua disponível ao administrador.
Não há execução de antecipação, baixa na agenda, confirmação bancária, integração RAV completa
ou classificação/lançamento automático na DRE. Vencimentos afetados não são saldo futuro apurado.

## Validação

- Checagem geral: 1.316 testes unitários aprovados, tipos, lint, contrato de erros e skills.
- Build aprovado; permanecem os avisos preexistentes de `firebase-rh.ts` e `@protobufjs/inquire`.
- Quatro E2Es de API aprovados com Auth/Firestore emulados em `demo-coala-e2e`, inclusive gravações
  concorrentes, revisão otimista, auditoria, referências ausentes e isolamento entre workspaces.
- Testes de apresentação reexecutados após os ajustes finais: sete aprovados. Texto para falta de
  evidência não transforma ausência em zero; resultado com vínculo diferente da seleção é rejeitado.
- Sem acesso ao navegador, sem chamada ao modelo ou à Stone nos testes, sem dados reais alterados.
- Dependências compartilhadas por symlink: CI com instalação limpa do lockfile ainda é necessário.
