# Coala Financeiro — piloto de leitura por unidade

## Entrega e limite

Implementação de backend, sem publicação automática. `POST /api/financial/agent` é uma consulta
somente de leitura, restrita a `isDefaultAdmin`, com intenção explícita `review_anticipations`.
Não há chat geral, cron, execução em segundo plano, alteração de caixa, baixa de agenda ou lançamento
na DRE. A tela Stone existente continua funcionando independentemente deste piloto.

Entrada: `{ "intent": "review_anticipations", "kioskId": "<id oficial>", "stoneCode": "<código>",
"referenceDate": "2026-09-21", "prioritizeWithAi": false }`.
O chamador usa o cliente autenticado central. Workspace e autorização vêm da sessão do servidor,
nunca do corpo nem do modelo. Vendas comerciais e intenções ainda não implementadas são rejeitadas.

## Fonte e vínculo

Reutiliza a coleção `stoneMerchantMappings` do módulo Stone já desenvolvido em outra frente.
Não cria coleção alternativa nem importa seus fluxos de ingestão/escrita. O cadastro administrativo
de vínculos daquela frente ainda precisa ser integrado/publicado separadamente.
O cadastro deve apontar unidade, conta do workspace, código e vigência. Não inferir vínculo por nome,
StoneCode escolhido em uma captura de tela ou semelhança entre totais.

Uma consulta por código examina até 101 vínculos do workspace (100 + sentinela) para detectar conflitos.
Mais de 100, campos inválidos, ausência, unidade divergente, vínculos simultâneos ou partições por
terminal bloqueiam antes da Stone. Vínculo inativo com vigência histórica encerrada pode servir à
data histórica; inativo sem fim de vigência não autoriza consulta. Datas finais são inclusivas.
Conta financeira deve possuir workspaceId explícito. Unidades legadas pertencem ao cadastro
operacional único do deployment; rejeita workspaceId diferente quando presente.

O vínculo é da **data de pagamento**: não comprova unidade da venda histórica nem conta efetivamente
creditada. Cadastros hoje inativos não apagam o histórico. Nenhum vínculo real é criado por esta entrega.

## Evidência e agente

Reutiliza `queryStoneAnticipationReview` e seu leitor XML 2.2. Retorna fonte, ferramenta, data-base,
coleta, arquivo, escopo, qualidade, parcelas, taxas explícitas, valores exatos, pendências e ações.
Resumo abrange somente parcelas antecipadas identificadas, não todos os recebimentos do dia.
Arquivo vazio não comprova ausência; arquivo original ausente não vira zero. Resíduos são verificados
por parcela, mesmo se os positivos e negativos se anularem no total.

Caixa bancário, DRE e carteira futura permanecem não confirmados. Não descontar novamente as taxas
do líquido. Não somar parcelas já antecipadas novamente ao futuro. A reconstrução oficial da carteira
e a conciliação com o banco são entregas posteriores, não resultados desta consulta.

`financial.agent` registra a política V3 com fronteira comercial/financeira. Nesta versão, o modelo
apenas ordena ações elegíveis. É opcional (`prioritizeWithAi=true` e `ENABLE_AI_FEATURES=true`), usa
Genkit/Gemini existente e recebe somente IDs de ações e contagens. Nenhuma nova chave/modelo/provedor.
Sua saída estruturada deve ser uma permutação completa das ações; ações omitidas, inventadas ou
duplicadas são rejeitadas. Falha/IA desligada retorna evidência determinística com estado explícito,
nunca afirma ter usado IA. Textos, valores e pendências são gerados por regras, não pelo modelo.

Uso da skill OpenAI Docs: separação de instruções/dados não confiáveis, saída estruturada e validação
fora do modelo, conforme https://developers.openai.com/api/docs/guides/agent-builder-safety.
Essa orientação não motivou troca de infraestrutura de IA.

## Custo e permissões (preflight)

- Consulta manual, sem polling/listener. Até 101 documentos de vínculos + 2 referências + até 2 de
  autenticação = teto conservador de 105 leituras por execução (normal: aproximadamente 5).
- Exemplo de capacidade, não medição: 5 consultas/h × 2 administradores × 8h/dia × 30 dias =
  2.400 execuções/mês; até 252.000 leituras, normalmente ~12.000. Zero escritas de negócio.
- Stone: até 32 arquivos por consulta, concorrência máxima 2; orçamento de 110s.
- IA: zero chamadas por padrão; no máximo uma por consulta opt-in, 300 tokens de saída e 20s.
- Novo índice composto workspaceId + stoneCodes (array) incluído no arquivo de índices financeiro.
- Sem novas permissões ou migração de perfis. Não administradores recebem 403 antes de ler vínculos,
  Stone ou modelo. Não há nova navegação/página nesta etapa. Banco admin SDK somente no backend.

## Próximos gates para ativação real

1. Integrar o cadastro administrativo de vínculos e confirmar unidade/conta/vigência reais.
2. Publicar o índice e o backend mediante autorização; testar consulta protegida por unidade.
3. Integrar a apresentação no aplicativo e o acionamento conversacional, sem adivinhar parâmetros.
4. Acrescentar ferramentas oficiais de PDV, banco, carteira futura e DRE, cada uma com seu contrato
   de completude, autorização e regressões. Não anunciar o agente financeiro geral antes disso.

## Validação local

- `npm run check`: 1.309 testes unitários aprovados, além de tipos, lint, contrato de erros e skills.
- `npm run verify`: aprovado, incluindo build. Permanecem avisos preexistentes de top-level await
  em `firebase-rh.ts` e importação dinâmica em `@protobufjs/inquire`, fora desta alteração.
- E2E somente de API: três testes aprovados no projeto `demo-coala-e2e`, com Auth/Firestore emulados;
  nenhum navegador controlado, credencial real, chamada Stone ou chamada ao modelo.
- Dez testes novos do agente cobrem acesso, entrada, vínculo, vigência histórica, cobertura parcial,
  taxas ausentes, resíduos que se anulam, opt-in e respostas inválidas do modelo.
- Dependências reutilizadas por symlink do workspace principal; não equivale a uma instalação limpa
  do lockfile. CI com instalação limpa continua necessário antes da publicação.
