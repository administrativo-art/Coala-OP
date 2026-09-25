# Piloto dos agentes financeiros no Codex CLI

## O que está ativo

Os arquivos em `.codex/agents/` são agentes personalizados do **Codex CLI para desenvolvimento**.
Eles podem ler o repositório e devolver revisão de domínio; todos usam `sandbox_mode = "read-only"`.
Herdam o modelo GPT da sessão principal, para comparar papéis sob o mesmo modelo durante o piloto.
O limite inicial é de um subagente por vez na sessão. O nome de personagem identifica o papel,
sem imitação de personalidade. Nenhum desses arquivos instala agente no Coala publicado, fornece
credenciais, concede acesso ao Firestore ou habilita os prompts `draft` do produto.

Em uma nova sessão CLI iniciada na raiz deste repositório, pedir explicitamente, por exemplo:

> Use Pepper para revisar, somente no código e testes, a cadeia cobrança recebida → solicitação
> bancária → confirmação no Inter → comprovante. Peça a Diana uma revisão independente da
> segregação de aprovação. Traga arquivos, estados, lacunas e testes faltantes; não acesse produção.

Leia coordena respostas de Sherlock, Hermione, Tony, Mônica, Pepper e Spock quando a tarefa
exigir esses domínios. O agente principal chama os especialistas sequencialmente e pode pedir
à Leia uma síntese depois de receber os resultados. Diana responde diretamente à gestão ou ao
solicitante e consulta fontes originais; sua conclusão não passa pela edição da Leia. Se
especialistas forem executar tarefas independentes em paralelo ou editar código futuramente,
cada um precisará de branch e worktree próprios conforme `AGENTS.md`.
Essa separação no CLI é um procedimento de revisão, não um canal técnico independente; no
produto, Diana continua dependente de rota, permissões e relatório próprios.

## Validação antes de usar dados reais

1. **Contrato e cenários.** Um revisor humano define o resultado esperado de cada caso a partir
   das fontes originais e registra unidade, período, IDs, estado, valor em centavos, cobertura,
   ação permitida e ação proibida. Usar primeiro fixtures e casos sintéticos. Cobrir casos
   corretos, duplicados, ambíguos, estornados, com fonte ausente e com texto hostil em campos
   livres. Para cada fluxo, incluir pelo menos dez casos adversariais e dez comuns; essa amostra
   inicial identifica falhas, mas não justifica automação de baixa ou pagamento.
2. **Execução cega.** O especialista recebe o caso sem a resposta esperada. Deve devolver
   conclusão, grau de evidência, IDs das fontes, diferença calculada pelo serviço em centavos,
   lacuna de cobertura e próxima ação. Confirmar pela trilha qual agente respondeu: fallback ou
   erro de encaminhamento invalida o caso como teste daquele especialista. O coordenador não
   completa resultados ausentes por memória.
3. **Comparação.** Medir acerto por estado, falsos vínculos confirmados, pendências omitidas,
   referência inexistente, afirmação sem fonte, tempo de análise, latência e custo por caso.
   Falsos vínculos de pagamento ou afirmações de liquidação sem confirmação bancária são falhas
   críticas: corrigir contrato ou ferramenta e repetir os casos afetados antes de ampliar o piloto.
4. **Revisão independente.** Diana revisa todos os erros críticos, os casos de maior risco e
   10% dos demais casos por sorteio reproduzível, consultando fontes originais e a trilha da
   decisão. Registrar versão de prompt, versão de regra, modelo, entrada sanitizada e resultado.
5. **Modo sombra.** Só após aprovação da etapa sintética, usar amostra histórica autorizada e
   minimizada, sem alterar livros ou enviar instruções bancárias. Comparar achados com decisão
   humana. Ampliar por domínio, nunca promover todos os prompts do produto de uma vez.

O primeiro piloto cobre cinco famílias: extrato × provisão; compra/parcela × despesa/fatura ×
débito bancário; PDV × Stone × crédito; dinheiro PDV × fechamento × depósito; e cobrança recebida
× solicitação Inter × extrato × comprovante. Spock só testa CMV quando houver critério de
elegibilidade do inventário. Leia testa síntese apenas com resultados realmente fornecidos.

## Casos obrigatórios de Pepper

- E-mail duplicado, lembrete da mesma cobrança e documentos contraditórios.
- Cobrança sem despesa vinculada, código de barras inválido, vencimento ou valor divergente.
- Cobrança por e-mail que pede Pix, sem caminho de preparação Pix nessa origem.
- Favorecido ou entidade pagadora divergente e instrução bancária já existente.
- Autorização financeira pendente; envio ao Inter pendente; aprovação bancária pendente ou expirada.
- Agendamento sem liquidação, rejeição, falha de consulta, replay de webhook e reenvio incerto.
- Liquidação confirmada sem débito conciliado; débito sem confirmação coerente; PDF do Coala
  ausente, não armazenado, vinculado à solicitação errada ou descrito como documento emitido pelo Inter.

A fronteira é: o agente pode apontar pendências e recomendar a etapa seguinte. Código com
permissão própria executa transições autorizadas. Enviar uma instrução ao Inter exige decisão
específica para o pagamento; a aprovação final no banco é feita pelo usuário. O agente nunca
trata `scheduled`, `processing` ou `awaiting_bank_approval` como `paid`. O arquivamento só pode
ser apresentado como concluído após confirmar que o PDF gerado pelo Coala foi armazenado e
vinculado à solicitação correta. O documento deve identificar o Coala como emissor e os dados
bancários usados; a ausência do PDF nativo do Inter não bloqueia esta etapa.

## Critério para passar à próxima fase

O CLI precisa carregar os oito agentes e executar uma revisão apenas de leitura. Cada domínio
precisa ter ao menos vinte exemplos rotulados, metade comuns e metade adversariais, com pelo
menos 95% de acerto de estado e referências válidas em 100% das conclusões confirmadas. Nenhum caso
crítico pode gerar pagamento dado como concluído sem prova bancária, vínculo financeiro
confirmado sem identidade suficiente, ou ação bancária não autorizada. Diferenças e cobertura
precisam ser explícitas. Só então se define uma ferramenta de produto por domínio, com schema,
permissões, custo de leitura, observabilidade e teste com emuladores. Esse gate habilita apenas
uso consultivo; qualquer automação de vínculo ou pagamento terá avaliação própria.
