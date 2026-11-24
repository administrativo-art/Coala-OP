# Recebimentos: pagamentos posteriores ao mês da venda

Decisão18/11/2026: corrigir todas as competências, sem hardcode outubro/novembro. Implementação, commit e rollout autorizados; nenhuma operação financeira, importação/sincronização ou reprocessamento global de produção está autorizada.

## Situação verificada

A lista mensal só lê pagamentos do próprio mês, mas chama de Não pago previsões vencidas em meses seguintes. O diagnóstico readonly conferiu11capturasElo/Tirirical e encontrou7pagamentosStone/R$84,09 nos arquivos03/11,04/11,09/11 já guardados;2futuros30/11. Carteira atualizada até17/11, semdiasfaltantes; carteira persiste apenas abertos, não permite inferir pagamento pela ausência. O índice disponível é stonePortfolioFiles/SHA(workspace:StoneCode)_data, XML imutável por dia, sem índice por transação.

## Execução

1. Leitor exclusivamente de arquivos persistidos, validando workspace/merchant/data/hash; nunca chamar readDay produtor como fallback. Consulta por intervalo deID do merchant, página16XML e janela calendário45dias para limites e lacunas, sem varredura global.
2. Coorte de vendas da competência identificada por transação+parcela. Aplicar pagamentos posteriores atéasOf fixo, incluindo antecipações/atrasos; outrosIDs não entram no mês. Base mensal/snapshot completo reaproveitado; ausência exige base de arquivos guardados, sem importação.
3. Continuação explícita da consulta na própria tela: mês/unidade/vínculo/asOf/fingerprint da coorte fixos. Acumular apenas páginas contíguas. Mudança de contexto/fonte reinicia. Arquivos ausentes ou limite geram Conferir/cobertura parcial; não ausência conclusiva de pagamento. Espécie/Pix e calendário de pagamentos do próprio mês preservados.
4. Testes com11itens do diagnóstico sintéticos, outros meses/viradaano, parcelas longas/antecipações, sempagamento e arquivosfaltantes, paginação/scope/respostaantiga. Typecheck, segurança/documentação e QA local. Revisão independente antescommit; PRmain quality+CodeQL, promoção seletiva e AppHosting/SHA/SUCCEEDED100%HTTP; arquivo e cleanup próprios.

## Custo e aceite

On-demand por competência/merchant:16XMLretornados por página (máximo800kB cada), janela45dias evita consultas diaadia ausentes. Base por página:1snapshot histórico completo ou até31arquivos diários + até60arquivos complementares de origem +fontesPIX/PDVlocais existentes. A reconstrução da base se repete na continuação quando não há snapshot elegível; o fingerprint impede misturar bases alteradas. Limites e próxima página explícitos; sempolling/censo/migração. Custo multiplica por usuários×ações; sem requisição automática para todosmeses. Outubro:7pagos84,09 emnovembro e2futuros; mês antigo/parcelado usa mesmo mecanismo e continua quandoexcede página. Pago significa eventoStone, sem afirmar créditoInter/extrato. Não cria/baixa/reclassifica despesas nem altera cadastros.
