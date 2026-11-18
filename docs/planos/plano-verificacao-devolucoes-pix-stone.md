# Verificação de devoluções Pix na Conciliação de vendas

## Decisão de 17/11/2026

Um cancelamento parcial ou total no PDV com pagamento Pix aprovado na Stone pode ser conferido quando o par é individual, tem o mesmo valor e a pesquisa pelo identificador completo da transação Stone cobre todos os arquivos publicados desde o dia da venda. Uma devolução, um evento ambíguo ou um intervalo sem cobertura mantém o caso em atenção. O fluxo só lê evidências e atualiza a revisão de vendas. Cartões continuam com as regras atuais.

O caso inicial é o Pix de R$ 33 do dia 21/09/2026 no vínculo Tirirical. A revisão salva registra cancelamento parcial no PDV e pagamento aprovado na Stone. A consulta manual pelo E2E exato nos 57 arquivos diários de 21/09 a 16/11 encontrou apenas o pagamento. O fluxo diário anterior coleta somente o arquivo da data de venda e o calendário usa revisões persistidas.

## Execução

1. Projetar eventos de devolução do arquivo diário original no banco financeiro, por workspace, documento e mês. Usar o hash do E2E como chave e validar o StoneCode em cada evidência. Guardar apenas os metadados necessários para a conciliação.
2. Invalidar o marcador diário junto com a aquisição do processamento do arquivo. Publicar os eventos e a cobertura somente com o processamento confirmado. Uma substituição autoritativa revoga a versão anterior. Um arquivo em processamento, inválido ou acima do limite deixa a data sem cobertura.
3. Consultar a projeção mensal com máscara dos E2Es em vez de reler linhas ou CSV. Limitar a janela a 366 dias e o tamanho mensal a 400 KiB. Uma avaliação consulta no máximo 13 documentos mensais para cada lote de casos de uma revisão. Chaves dinâmicas e projeções não precisam de índices de campo.
4. Gravar evidência, classificação e corte na revisão, reaproveitando as fontes salvas no acompanhamento posterior. Priorizar reavaliação limitada no robô para casos candidatos, inclusive fora da janela de sete dias. Novas evidências devem reabrir pendência e preservar as revisões anteriores. A atualização do corte sem mudança na conclusão deve ter custo limitado.
5. Testar isolamento, identidade exata, arquivos ausentes e republicados, duplicidade, casos adversos e reabertura. Publicar pelo fluxo de qualidade normal, verificar o rollout e executar prévia delimitada para o vínculo autorizado antes de aplicar o histórico.

A implantação de código não cria cobertura retroativa. O arquivo legado guardava linhas normalizadas e hash, sem guardar o cabeçalho ou o CSV original. Nem o arquivo vazio nem a ausência de `refundId` nas linhas comprovam que a coluna de devolução existia. O primeiro preenchimento histórico usa a [re-emissão oficial V2](https://conciliacao.stone.com.br/reference/pix-solicita%C3%A7%C3%A3o-de-arquivo) no job Pix existente, por documento e pelas datas do vínculo Tirirical, de 20/09/2026 até o corte autorizado. Um plano temporário delimita vínculo, datas, geração de origem e expiração. A rotina emite no máximo 8 pedidos adicionais por execução. A revisão de venda é reavaliada apenas após o webhook validar o layout e completar a projeção, com revisão original e trilha de auditoria preservadas.
