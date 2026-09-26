# Cobertura documental da main

Base `70aaab65`. Inventários regenerados contra o código desta versão; mapas servem à investigação seletiva e devem ser conferidos no código antes de concluir sobre comportamento.

| Indicador | Total |
| --- | --- |
| Páginas do dashboard | 156 |
| Páginas externas | 20 |
| APIs por arquivo handler | 352 |
| Exports de Functions | 42 |
| Grupos com ao menos um guia | 53/53 |
| Grupos marcados `Traçado` | 53/53 |
| Grupos marcados `Verificado` | 0/53 |
| Guias de subfluxo | 72 |

A [matriz de páginas](flow-matrix.csv), [matriz de superfícies](surface-flow-matrix.csv) e verificadores exigem caminhos e classificação atuais. Os [limites por grupo](flow-verification.md) não foram resolvidos por documentação. O [relatório de integração](main-map-integration.md) distingue a main das correções locais anteriores.

## Consumo de tokens

O [piloto histórico](token-measurement.md) observou +10,98% de entrada agregada com o mapa, sem economia geral demonstrada. Não representa o código atual da main nem prova efeito causal nas próximas tarefas. A direção vigente é [acompanhar o uso real](map-usage.md), sem novas sessões artificiais.

## Pendências preservadas

Os sete [achados A08](surface-audit.md) estão adiados por decisão do usuário. Validação integrada dos módulos, TV física e provedores continuam pendentes. Este documento encerra a compatibilização dos mapas, não a homologação funcional.
