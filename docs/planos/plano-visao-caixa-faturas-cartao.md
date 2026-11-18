# Visão do caixa por fatura de cartão

## Situação verificada

Em 18/11/2026 a Visão do caixa usa saldo global da compra com vencimento global, inclusive compras parceladas em cartão. Dois exemplos concentram R$ 1.536,46 em hoje, embora R$ 1.060,89 sejam parcelas futuras e R$ 475,57 sejam legado inconclusivo. A fatura atual está paga. Evidência privada: chamado cash-card-outflows-diagnosis-20261118.

## Decisão — 18/11/2026

- Compra explicitamente `credit_card` não é saída bancária direta nem despesa lançada que cobre uma média recorrente. A DRE e os dados de origem não mudam.
- Fatura aberta com total conhecido e vencimento válido gera uma única obrigação de caixa; saldo oficial da obrigação tem precedência e pagamento confirmado impede nova saída. Faturas contraditórias ficam para conferir.
- Parcelas futuras explícitas podem formar previsão por conta + instrumento + vencimento, identificada como previsão de fatura; uma fatura existente no mesmo ciclo substitui a previsão. Sem data, vínculo ou cobertura, não inventar saída/zero.
- Legado vencido sem fatura confiável fica em aviso para conferir, sem antecipar todo saldo da compra para hoje. Histórico recebido não é apagado.
- Não há lançamentos, baixa, sincronização, cadastro ou consulta real nova para implementar/testar. Autorização atual cobre implementação e commit local; publicação foi autorizada posteriormente pelo usuário e será coordenada por Nemo após a revisão consultiva financeira; esta etapa entrega apenas commit local.

## Execução e custo

1. Normalização compartilhada, leitor de cabeçalhos com máscara e limites; agregação pura e avisos.
2. Integrar somente à Visão do caixa, preservando projeção/realizado e permissões existentes (administrador padrão no servidor).
3. Regressão de fatura paga/aberta/parcial, parcelas futuras/antigas, duplicados, inconsistências e carregador demo real; typecheck, lint, documentação e revisão financeira sequencial antes da integração/publicação.

Consulta sob demanda: até 121 cabeçalhos abertos/fechados + no máximo 120 cabeçalhos por IDs explícitos das despesas + 240 obrigações por IDs (getAll em blocos de 50). Excesso ou ausência vira cobertura parcial visível. Não varrer coleções completas, não polling. Pior caso adicional 481 documentos por abertura × 2 aberturas/h × 1 administrador × 8 h/dia = 7.696 leituras/dia; exemplo 22 dias = 169.312 leituras/mês. É teto, não medição. Cabeçalhos e obrigações usam somente campos financeiros, sem atores/anexos/allocations. Se necessário exceder limite, manter aviso; não declarar ausência de dívida.

Incompletude de referência/obrigação é isolada no instrumento/ciclo afetado; não suprime previsões confiáveis de instrumentos alheios. Truncamento da lista de cabeçalhos ativos ou das compras tem efeito global porque impede provar cobertura dos ciclos. Aviso de cobertura parcial continua visível.
