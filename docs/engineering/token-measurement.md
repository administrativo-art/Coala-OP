# Medição de tokens — piloto local

**Registro histórico do worktree docs/system-map, incluindo correções locais não integradas. As fontes citadas descrevem aquela cópia; este piloto não mediu a main.**

Data: 2026-09-26. Etapa 9 do [acompanhamento](system-map-execution.md). O objetivo é comparar descoberta direta no código com mapa curto → guia pertinente → confirmação no código. A medição não certifica os módulos nem mede cobrança ou cota do plano.

## Protocolo

- Codex CLI 0.157.0, autenticação existente via ChatGPT, modelo solicitado `gpt-6-luna`, raciocínio `medium`, seis sessões novas e efêmeras. Nenhum serviço contratado ou chave de API configurada.
- Três perguntas iguais entre condições: token do heartbeat; planejamento de mudança nos dados do QR patrimonial; confirmação de estoque e efeitos financeiros. Apenas investigação, resposta limitada a 550 palavras; testes não executados pelos participantes.
- A: descoberta por buscas no código, sem `docs/engineering`. B: mesmo código, acrescido dessa documentação e instrução para começar pelo mapa/harness. Outros documentos existentes foram preservados nos dois lados. Portanto, comparamos o pacote documental, não o efeito isolado de um único arquivo.
- Cópias descartáveis com os mesmos arquivos de produto, testes e scripts; sem `.env`, credenciais, `.git`, dependências instaladas ou configurações de agentes do projeto. Manifesto SHA-256 dos arquivos guardado no registro local. A cópia não acompanha mudanças posteriores.
- `read-only`, aprovação `never`, busca web e multiagentes desativados, configuração pessoal ignorada, carregamento automático de AGENTS desativado para não contaminar A com a obrigação de consultar o mapa. Memórias desativadas. O prompt comum restringe leituras à cópia; isso não é apresentado como confinamento completo de leitura do sistema operacional. Comandos efetivamente emitidos são revisados.
- Ordem sequencial: heartbeat A/B, patrimônio B/A, compras A/B. Uma execução por condição/pergunta, sem repetição estatística nem seleção do melhor resultado; timeout de 240 segundos interrompe o piloto se uma execução falhar.
- Uso extraído de `turn.completed.usage` do JSONL. Entrada inclui contexto reutilizado em várias chamadas; `cached_input_tokens` já faz parte da entrada, não deve ser somado novamente. Relatar entrada, cache e saída separadamente. Tempo é de parede, com variação de rede/provedor.

O evento de uso é documentado em [modo não interativo do Codex](https://learn.chatgpt.com/docs/non-interactive-mode); opções de contexto em [referência de configuração](https://learn.chatgpt.com/docs/config-file/config-reference). A telemetria deste formato não identifica o modelo efetivamente servido: registramos o solicitado, sem alegar confirmação independente.

## Critério de qualidade

Revisão manual das respostas contra o código, sem avaliador de IA adicional:

| Pergunta | Conteúdo necessário |
| --- | --- |
| Heartbeat | Envio do cabeçalho; token configurado versus legado; origem do quiosque e persistência sem segredo; teste existente e limite de execução. |
| QR patrimonial | Página/componente, DTO e API; login e `assets.view` no servidor, workspace; histórico separado por `assets.viewHistory`; transporte autenticado e testes de acesso/retorno do login. |
| Compras | Entrada da interface e rota; transação, limites e repetição; lotes/histórico/patrimônio e `purchase_financials`; distinguir a despesa em outro banco do efeito direto da confirmação; recuperação e testes de falha/concorrência. |

A rubrica foi registrada após a primeira resposta de heartbeat e antes das respostas de patrimônio/compras; não é um protocolo pré-registrado ou avaliação cega. O consumo só é interpretado junto das lacunas de qualidade.

## Resultados

Todas as seis sessões terminaram com exit 0 e evento de uso. A = busca direta; B = mapa e guias. Os hashes das cópias permaneceram iguais após a execução. Os eventos contêm apenas mensagens e comandos locais de leitura; não houve ferramenta de navegador, escrita ou delegação. A listagem dos comandos fica nos JSONLs, com os arquivos/trechos consultados; não inferimos uma contagem exata de arquivos lidos a partir de buscas recursivas.

| Pergunta / condição | Entrada | Cache (incluído) | Saída | Segundos | Comandos shell |
| --- | ---: | ---: | ---: | ---: | ---: |
| heartbeat-A | 71.592 | 56.320 | 920 | 28.48 | 3 |
| heartbeat-B | 126.565 | 107.776 | 1.244 | 37.39 | 6 |
| asset_qr-B | 143.156 | 108.032 | 1.495 | 69.46 | 5 |
| asset_qr-A | 201.781 | 171.008 | 2.051 | 50.96 | 7 |
| receipt-A | 124.348 | 102.912 | 1.531 | 41.22 | 5 |
| receipt-B | 171.688 | 139.520 | 1.596 | 46.48 | 6 |

| Total das três perguntas | A | B | Variação B versus A |
| --- | ---: | ---: | ---: |
| Entrada | 397.721 | 441.409 | +10,98% |
| Entrada com cache (incluída acima) | 330.240 | 355.328 | +7,60% |
| Entrada sem cache (diferença aritmética) | 67.481 | 86.081 | +27,56% |
| Saída | 4.502 | 4.335 | −3,71% |
| Tempo em segundos | 120,66 | 153,33 | +27,08% |

O campo separado `reasoning_output_tokens` reportou 213 em A e 174 em B; preservado sem somá-lo à saída, evitando pressupor a relação entre campos. `cache_write_input_tokens` foi zero nas seis sessões.

**Conclusão observada:** não houve economia agregada de entrada neste piloto. Heartbeat aumentou 76,79%; patrimônio reduziu 29,05%; compras aumentou 38,07%. O mapa pode ajudar a encontrar dependências, mas sua leitura também custa tokens. Não extrapolar esses percentuais para todos os pedidos, outros modelos ou Claude Code.

### Revisão das respostas

- **Heartbeat:** ambas cobrem os quatro pontos da rubrica com fontes e sem alegar execução de testes. B explicita ausência de login de usuário no POST e limites de TV física. Fontes: [rota](../../src/app/api/signage/heartbeat/route.ts), [player](../../src/components/signage/signage-player.tsx) e E2E (arquivo apenas no worktree histórico: `../../tests/e2e/access-controls.spec.ts`). Qualidade central comparável; B fez seis comandos, A três.
- **Patrimônio:** ambas identificam componente/contrato, autorização no servidor, histórico separado, testes e retorno do login. A localiza também o scanner; B explicita o filtro de workspace da API por código. Nenhuma explicita o uso do transporte compartilhado na resposta, embora tenham lido o componente. Fontes: consulta (arquivo apenas no worktree histórico: `../../src/components/asset-lookup-page.tsx`), API por código (arquivo apenas no worktree histórico: `../../src/app/api/assets/by-code/[code]/route.ts`), [histórico](../../src/app/api/assets/[assetId]/movements/route.ts). Respostas úteis para o planejamento inicial, com essa omissão comum.
- **Compras:** A identifica interface/provider e sincronização posterior da tarefa, mas omite limites numéricos e a recuperação de despesas entre bancos. B distingue `purchase_financials` da despesa em outro banco e menciona `pending`/202/retomada, sem afirmar que confirmar estoque dispara essa sincronização. Contudo, B não identifica componente/provider nem ID estável da despesa; parte da recuperação foi obtida dos guias sem conferir diretamente a função e o teste completos. Fontes conferidas pela coordenação: [provider](../../src/components/purchase-receipt-provider.tsx), [rota e syncPurchaseExpenseWithRecovery](../../src/app/api/purchasing/[...path]/route.ts), testes (arquivo apenas no worktree histórico: `../../tests/e2e/stage7-recovery.spec.ts`). A cobertura difere e nenhuma resposta é uma auditoria completa. O consumo de compras não é prova de custo para qualidade equivalente.

### Decisão após o piloto

Manter o mapa como orientação de localização e dependências, sem anunciar redução geral de tokens. Não instalar GitNexus, Serena, Repomix ou serviço pago com base nesta amostra. Uma próxima otimização pode limitar a leitura ao trecho pertinente do índice e evitar reler o harness já carregado na sessão; isso exige nova comparação antes de alegar ganho. Não modificamos a política durante a medição nem repetimos somente resultados desfavoráveis.

Evidências locais: `.ai-work/development-technology/system-map/stage9/` contém protocolo, prompts, manifesto, rubrica, JSONL, respostas, stderr e resumos. Esse diretório é ignorado pelo Git; os resultados consolidados deste documento permanecem no repositório. Cópias descartáveis e script de execução única removidos após conferência; respostas brutas retêm caminhos temporários como evidência histórica.

## Limites

Três perguntas escolhidas de fluxos recentemente corrigidos não representam todo o sistema. Não houve implementação, sessão longa ou comparação com o histórico real do Claude Code mostrado pelo usuário. Instruções globais e configuração foram reduzidas igualmente, mas não medimos cada byte do contexto interno. Cache não foi controlado; alternar a ordem apenas reduz um possível viés. O custo de criar/manter os mapas e o trabalho desta sessão coordenadora não integra o uso dos participantes. Nenhum percentual deste piloto pode ser convertido diretamente em dinheiro, cota ou economia futura.

A checagem geral do projeto rodou durante parte das sessões de patrimônio/compras. Portanto, os tempos têm também interferência de carga local e não sustentam conclusão de velocidade. Não houve repetição para controlar esse fator.

## Verificação da entrega

`npm run check` terminou com exit 0: 1.427 testes, zero falhas, tipos, lint, contrato de erro e validadores de skills/agentes. Os cinco verificadores do mapa passaram: inventários atuais, 156 páginas classificadas, 53 grupos e 132 documentos com links locais válidos; `git diff --check` passou. Não foi necessário repetir E2Es, emuladores ou build por esta alteração documental. Log local: `.ai-work/development-technology/system-map/stage9-check.log`.

## Protocolo experimental arquivado — consulta seletiva (não executado)

**Direção vigente:** por decisão do usuário, acompanhar [tarefas reais](map-usage.md). O protocolo abaixo fica como referência; não é a próxima ação nem foi executado.

A revisão posterior do AGENTS.md/mapa/harness passa a orientar busca por linha/seção, reutilização do procedimento em contexto e uso de inventário apenas quando faltar localização. Não se atribui economia a essa revisão sem uma nova execução.

Para medir, congelar o mesmo código em três condições: A, descoberta direta; B, documentação e orientação anteriores preservadas; C, orientação seletiva revisada. Repetir as três perguntas e a rubrica original, com mesmo modelo/esforço, ferramentas e limite de resposta. Manter o número de repetições igual para todas as condições, definir a ordem antes de começar e alterná-la entre perguntas. Preservar os prompts e todas as execuções, inclusive falhas. Rodar a checagem do projeto fora da medição para evitar interferência no tempo.

Comparar C com A e B da **nova rodada**, separando entrada/cache/saída, comandos e cobertura factual. Os números do piloto anterior são históricos, não um controle contemporâneo. Não escolher só o melhor caso, nem alegar ganho quando faltar conteúdo exigido. Um eventual benefício de reutilizar contexto precisa de um ensaio separado com perguntas sucessivas; sessões novas não medem esse benefício.
