# Taxas confirmadas de Recebimentos → reconhecimento/DRE

Decisão17/11/2026: reutilizar as referências já confirmadas por unidade/vínculo/StoneCode e grupo; não exigir novo cadastro percentual nem chamar referência observada de contrato documental. Publicação autorizada; confirmar taxas/configurações/lançamentos reais não está autorizado.

## Situação e execução

1. Fonte existente stoneReceiptDecisions/eventos: preservar escopo exato, revisão/autor, data de início explicitamente confirmada e histórico. Sugestão por recorrência não é vigência automática. Resolver referência na data da venda, separando bandeira/modalidade/parcelas e PIX.
2. Apuração: MDR explícito/líquido comprovado Stone precede referência confirmada; estimativa identifica origem e revisão. Contratos opcionais legados continuam compatíveis. Cadastro contábil/autorizações não equivale a recadastrar percentual. Reconhecimento exige conciliação bruta e preserva claims/ajustes delta/competência existentes, revalidando referência na transação.
3. Aba Taxas existente: alertas no topo/contador; taxas confirmadas por unidade, filtro vínculo/comparação todas unidades autorizadas, sugestões separadas, início/autor e histórico. Consultas explícitas limitadas/paginadas; sem polling global. Investigar e confirmar vigência são ações distintas.
4. DRE: aviso de estimadas/pendentes com acesso à aba Taxas, sem nova dedução ou receita e sem declarar cobertura certificada.
5. Testar prioridade, vigência, isolamento entre vínculos/contas/unidades, histórico/concor­rência, arredondamento/Pix/antecipação, rotas e navegação. Checks, revisão independente antes commit; PRmain/quality/promoção/rollout verificado. Nenhuma configuração ou despesa real será criada automaticamente.

## Aceite e limites

Venda100/taxa explícita2,50 vence referência3%; sem explícita e com referência confirmada vigente→estimativa3, sem pagamento antecipado. Sem referência ou sugestão não confirmada→pendente≠zero. Referência de outro vínculo nunca elegível; alteração concorrente invalida prévia. Confirmar início é ação explícita auditada. Contrato documental não é inferido de referência operacional. TaxasDRE não serão descontadas novamente se já reconhecidas pelos claims. Consultas somente fixtures/emulador durante implementação; produção só verificação técnica de publicação. Tetos porconsulta declarados no servidor, volume excedido indisponível em vez de conclusão parcial silenciosa.
