# Visão do caixa — estágios do numerário

Decisão de 18/11/2026. Implementação local; publicação não autorizada neste chamado.

O diagnóstico de outubro encontrou 82 dias aprovados cobertos por cinco sessões concluídas e oito boletos com Inter RECEBIDO. Cabeçalhos legados ainda indicam `dre_only`/`not_eligible`; dias parciais aparecem como se todo o numerário ainda aguardasse contagem.

## Regras

- Pendência de espécie fica em quadro operacional, com data original, fora das entradas, gráficos e saldo projetado em ambos os modos.
- Distinguir aguardando contagem, parcial, contado, incluído em malote e recebido. `dre_only` impede previsão de depósito, mas não prova recebimento.
- Recebimento exige sessão concluída, vínculos oficiais por unidade/data, todos os malotes e cobrança ativa Inter RECEBIDO, BOLETO, não manual e valor recebido igual ao nominal e ao lote. Moedas retornadas ao caixa não geram nova entrada.
- Contagem parcial mostra quantidades oficiais e remanescente indisponível; nunca calcular dinheiro faltante por esperado menos contado.
- Boleto emitido ainda não recebido mantém sua previsão existente. Evidência de recebimento prevalece sobre projeção de cabeçalho desatualizada.

## Execução e custo

Reutilizar os 200 lotes já lidos. Ler sessões referenciadas por ID (até 200), até 50 sessões abertas/contadas com índice existente e até 200 cobranças ativas por ID, com máscara sem atores/pagador. Limites, fonte ausente e escopo divergente geram lacuna explícita; nenhuma consulta ilimitada, coleção, índice, job ou migração nova. O acesso permanece restrito ao administrador padrão.

Implementar contrato puro e carregador somente leitura; separar quadro operacional da previsão; testar outubro sintético (82/82), outros meses, parcial, moedas, duplicidade, ausência de prova e escopo. Executar lint, typecheck integral, testes dirigidos, contratos de segurança, inventários e QA local. Congelar para revisão independente antes de qualquer commit. Nenhuma escrita financeira ou consulta de produção durante implementação.

## Recorte das pendências — decisão de 18/11/2026

O quadro operacional mostra pendências de espécie com data original a partir de **01/10/2026**, em todas as unidades e estágios pendentes (aguardando, parcial, contado, malote, fora do fluxo ou conferir). A constante `CASH_PENDING_FROM` e o filtro de apresentação usam `originDate`, nunca a data de fluxo deslocada para hoje. Recebidos continuam como histórico; boletos legítimos, Stone, saldo, médias, DRE e relatórios não são filtrados. Agosto/setembro permanecem nos módulos de Fechamentos e Depósitos. Sem apagar dados, publicar ou alterar a regra bancária. Novo commit local após revisão dirigida, preservando o commit anterior.
