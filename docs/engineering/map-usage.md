# Acompanhamento do mapa no uso real

Aplicar nas tarefas normais que precisem localizar código ou avaliar impacto. O [mapa curto](system-map.md) e o [procedimento](investigation-harness.md) orientam a investigação; este acompanhamento não cria uma nova investigação nem exige ferramentas pagas.

## Registro mínimo por tarefa

Acrescentar uma seção curta ao registro já existente em `.ai-work/development-technology/<id>/record.md`. Atualizar a mesma seção no fechamento, sem duplicar contadores cumulativos. Não criar outro agente, sessão de benchmark ou repetir a tarefa para coletar números. Não coletar credenciais, conteúdo do usuário ou transcrições completas para esse fim.

```text
Uso do mapa
- Tarefa / categoria: pergunta, alteração local ou impacto entre módulos
- Base: branch, commit e indicação de mudanças locais
- CLI / modelo: efetivo quando informado; solicitado quando não confirmado
- Consulta: nova ou reaproveitada; guias/seções e principais fontes de código
- Telemetria: entrada / cache / saída; fonte e intervalo medido
- Se indisponível: motivo (sem contador, contador só de sessão etc.)
- Qualidade: entregue, parcial ou bloqueada; verificações e retrabalho observado
- Mapa: referência útil, caminho ausente/desatualizado ou leitura desnecessária
```

Preencher a partir do que já foi observado. Quando disponíveis, usar contadores por tarefa/turno ou diferença entre dois contadores cumulativos da mesma sessão, com início e fim registrados e escopo sem sobreposição. Se não for possível atribuir o consumo, marcar indisponível; ausência de dado não é zero. Não ler arquivos pessoais de configuração, autenticação ou sessões alheias para tentar preencher números faltantes.

Entrada, cache e saída permanecem separados conforme a telemetria original. Cache que já faz parte da entrada não é somado novamente. Registrar eventuais reinícios, mudanças de modelo e sessões adicionais autorizadas; não somar intervalos sobrepostos. Tempo só entra quando medido, separando espera pelo usuário e execução de testes quando possível.

## Como avaliar depois

Revisar após dez tarefas reais registradas, como ponto de acompanhamento operacional, não como tamanho de amostra estatisticamente suficiente. Incluir todas as tarefas elegíveis desse período, inclusive falhas e registros sem telemetria. Informar quantas têm contadores utilizáveis. Agrupar por tipo de tarefa e modelo; não comparar uma pergunta curta com uma implementação completa como se fossem equivalentes.

O registro mostra consumo, qualidade, retrabalho e utilidade do mapa. Sem uma base comparável, não demonstra economia causada pelo mapa. Não converter tokens em cobrança ou cota do plano. O [piloto anterior](token-measurement.md) continua histórico e não serve como controle das tarefas atuais. Novas tarefas ainda não ocorreram: não há economia observada desta modalidade.

## Alcance e manutenção

AGENTS.md e CLAUDE.md do repositório direcionam a consulta aos mapas da mesma versão do código. Depois da integração em main, novos trabalhos devem partir dessa versão; worktrees antigos precisam receber a atualização documental pelo fluxo Git adotado. Não consultar um worktree diferente como se fosse a implementação atual.

A [integração documental](main-map-integration.md) preserva as correções locais e os achados A08 como pendentes. Usar o mapa não depende de resolver esses achados. Não há coleta automática externa: a orientação exige registro no chamado quando houver dado observável.
