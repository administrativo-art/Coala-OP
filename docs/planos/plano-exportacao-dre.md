# Exportação da DRE — mensal e doze meses

Estado (17/11/2026): implementação local autorizada, commit local após revisão; publicação proibida. Branch isolada sobre b3c4a1f9 (integridade/rateio ainda não integrado), main consultada 516ff7cf sem avanços.

Entregas: exportação PDF A4 com timbre oficial Coala e Excel real; seleção mensal/12 meses terminando no mês selecionado, unidade(s), CMV exclusivamente por movimentação de estoque (decisão usuário17/11/2026), independente do seletor da tela. Extrair núcleo de cálculo puro para ser usado tanto pela tela como pelo relatório; servidor carrega fontes oficiais e aplica autorização de DRE/unidades e minimização de detalhes. Metadados e avisos de cobertura, indisponível diferente de zero, mês atual parcial, período anterior não comparável em mês parcial. Sem pró-rata: despesas e CMV por composição fechada são mensais e não permitem corte homogêneo por dia.

Sequência: núcleo compartilhado e contrato; carregador limitado/rota secureRoute; renderers PDF/XLSX e menu; catálogo/documentação; testes sintéticos, amostras e inspeção visual; revisão independente; commit local. Nenhuma consulta financeira real necessária. Relatório transitório: sem Storage, assinatura, publicação automática ou nova coleção. PDF institucional catalogado contextual; pessoa titular não se aplica, ator somente autorização da sessão, sem nomes pessoais na saída. Retenção de download a cargo do usuário, sem retenção de instância no servidor.

Custos: endpoint ad hoc, sem listener. Até13 competências (12+anterior), somente a partir do inícioDRE08/2026; fontes em lotes até4 meses com limites existentes, estoque até25mil movimentos; catálogos limitados e contas por IDs. Limite excedido recusa exportação, nunca arquivo truncado. Dados provisórios e fonte estoque indisponível identificados; meses anteriores à cobertura são indisponíveis. Validação não deve consultar produção.

Pendências para conclusão: implementar/testar/revisar, commit local. Integração/publicação dependem de autorização futura.

Decisão adicional usuário17/11/2026: resultado permanece CMVestoque, mas mensal inclui anexo analítico estoque×fichas, ponte por ID/loja/medida e detalhamento integral no Excel. Reutiliza contribuições dos movimentos já lidos; composição selecionada somente mês final, snapshots fechados íntegros ou fichas atuais abertas. Falha/incompletude só torna anexo indisponível; não substitui DREestoque.12meses sem anexo anual de composição, matrizDRE em2blocos6meses porPDF e XLSX completo. Sem nova consulta produção para implementação.

Revisão independente17/11: corrigidos centro compartilhado (fechamento de escopo antes dos valores, consolidado único e individuais sem atribuição indisponíveis), referências de snapshot/custos preservadas e datas brasileiras. Testes do carregador completo usam banco falso para A/B restrito, seleção parcial, grupo inteiro e conservação de centros exclusivos. Sem regra nova de rateio nem consultas de produção.
