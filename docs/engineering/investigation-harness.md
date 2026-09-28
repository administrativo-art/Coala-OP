# Procedimento de investigação e manutenção

Use este procedimento para perguntas e alterações no Coala One. Ele organiza a consulta **direcionada** ao código; o [índice curto](system-map.md) é a entrada, o [catálogo de chamadas candidatas](flow-entrypoints.md) ajuda a achar a interface e os [guias de fluxo](flow-coverage.md) registram o percurso já conferido.

## 1. Localizar

1. Buscar a área do pedido no [mapa curto](system-map.md), com `rg -n -i 'termo|sinônimo' docs/engineering/system-map.md`. Se não encontrar, ampliar os termos ou ler o índice. Reutilizar este procedimento quando já estiver no contexto e não tiver mudado; reler após perda de contexto ou alteração do arquivo.
2. Seguir o link pertinente. No guia, localizar títulos/termos com `rg -n` e ler a seção necessária com seu contexto (`sed -n` ou equivalente). Se o caminho do código já estiver identificado, conferir sua implementação e a seção do guia que descreve contrato e dependências. Não percorrer todos os índices por rotina.
3. Quando faltar um caminho, escolher **o índice que resolve essa lacuna**: [páginas internas](route-inventory.md), [matriz página → grupo](flow-matrix.csv), [chamadas candidatas](flow-entrypoints.md), [guias por grupo](flow-coverage.md), [páginas externas](external-page-map.md) ou [APIs e Functions](surface-inventory.md). Para dependências sem tela, consultar [jobs/webhooks](runtime-surfaces.md) ou [acesso/privacidade](access-and-privacy.md). Consultar a [auditoria](surface-audit.md) quando seus achados afetarem a tarefa.
4. Confirmar no código as afirmações da resposta e os contratos afetados pela alteração: interface → chamada → servidor → dados → consumidores relevantes. Para efeitos entre módulos/bancos, seguir cada fronteira. Ampliar a leitura se houver referência ausente, divergência, autorização não confirmada ou dependência sem explicação. Não limitar a investigação por uma quantidade arbitrária de arquivos ou tokens.

Uma pergunta pontual pode terminar após localizar ação, autorização, persistência e teste pertinente. Uma alteração exige conferir também consumidores e efeitos indiretos. Não carregar guias inteiros, todas as matrizes ou relatórios completos quando uma seção resolve a dúvida. Isso é uma orientação de consulta; a economia precisa ser medida.

## 2. Responder ou alterar

| Pedido | Registro mínimo antes de responder/escrever |
| --- | --- |
| Pergunta sobre comportamento | Arquivo/função que executa a ação, entrada, dados consultados, autorização e limite do que foi conferido. Não editar o produto. |
| Pedido de alteração | Os mesmos pontos, mais contrato/estado afetado, consumidores, efeitos em outros bancos/serviços e verificação adequada. Atualizar o guia no mesmo trabalho. |

O [guia profundo](flows/TEMPLATE.md) fornece os campos de investigação. Separar [comportamento observado de regra aprovada](business-rules.md); se houver conflito, registrar ambos. Não transformar ausência de teste ou botão em regra de negócio. Para autorização, conferir o servidor e o escopo de unidade/pessoa; a interface só indica intenção.

## 3. Concluir e atualizar

1. Executar os testes e verificadores pertinentes em [verificação](verification.md). Para mudança em página do dashboard, rodar `generate-route-inventory.py`, atualizar a matriz e rodar `generate-flow-entrypoints.py`. Para página pública ou API, rodar `generate-surface-inventory.py` e revisar manualmente consumidores e guias.
2. Atualizar [cobertura](flow-coverage.md) e [acompanhamento](system-map-execution.md) **no mesmo trabalho**. Manter `Localizado` se o percurso ainda tiver lacunas, `Traçado` quando o percurso estiver documentado e `Verificado` só após conferir fontes, permissões e testes pertinentes.
3. Acrescentar ao registro local o [uso do mapa](map-usage.md), com telemetria quando disponível e lacunas/retrabalho observados, sem iniciar medições artificiais. Relatar o que mudou, arquivos de fonte usados, verificações executadas e lacunas reais. Não afirmar economia de tokens sem medição comparável; o [relatório de auditoria](coverage-audit.md) registra essa condição.

Comandos estruturais: `python3 scripts/generate-route-inventory.py --check`, `python3 scripts/generate-surface-inventory.py --check`, `python3 scripts/check-flow-matrix.py`, `python3 scripts/generate-flow-entrypoints.py --check`, `python3 scripts/check-engineering-docs.py`. O [CI](../../.github/workflows/verify.yml) executa esses comandos; eles detectam estrutura desatualizada e links inválidos, mas não substituem a leitura do comportamento.
