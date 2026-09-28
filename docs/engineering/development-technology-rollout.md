# Rollout do Departamento de Desenvolvimento e Tecnologia

## Escopo desta entrega

Este rollout ativa regras de trabalho e sete perfis locais no Codex e no Claude Code. Não altera o produto em execução, banco de dados, permissões de usuários finais ou infraestrutura de produção. O coordenador é a sessão principal, TARS; o programador pode apresentar o objetivo sem escolher um especialista.

## Pré-requisitos no ambiente de cada programador

1. Abrir o repositório na revisão publicada e executar `npm run agents:validate` para conferir os sete perfis e os limites estáticos. `npm run check` inclui essa validação.
2. Conferir a versão do Claude Code. `enforceAvailableModels` exige 2.1.175 ou posterior. Nesta máquina, em 2026-09-23, `claude` no `PATH` apontava para 2.1.76; `/Users/imated/.npm-global/bin/claude` era 2.1.281. Usar a instalação compatível até corrigir o `PATH`. Conferir a versão também no editor, caso ele use instalação própria.
3. Conferir a configuração efetiva e os sete perfis carregados em cada CLI. No Claude Code, verificar a seleção disponível de modelos sem iniciar Fable/Opus; no Codex, conferir o modelo efetivo do chamado. As configurações do projeto são padrão e restrições locais, não um limite administrativo global de consumo.
4. Antes do primeiro chamado, conferir permissões da sessão e conectores disponíveis. Velma e Trinity só atuam como revisores de leitura quando a sessão efetiva também impede escrita.

## Ativação

1. Integrar este commit pela rotina normal de revisão do repositório. Push, merge e deploy requerem autorização própria.
2. Iniciar um chamado pequeno pelo Codex ou Claude Code, declarando objetivo e escopo. TARS escolhe os especialistas e modelos apropriados, um especialista por vez.
3. Criar o registro em `.ai-work/development-technology/<id>/record.md` a partir do modelo versionado. Esse diretório é ignorado pelo Git; não colocar segredos nele.
4. Se trocar de CLI, encerrar a execução anterior, registrar a entrega ou ponto de retomada e conferir arquivos e processos antes de a nova sessão continuar.

## Sinais de sucesso e limites

- Os sete perfis aparecem em cada CLI; `npm run agents:validate` e `npm run check` passam.
- O chamado registra especialista, modelo solicitado e efetivo quando disponível, alterações, testes executados, resultados e pendências.
- Nenhum especialista delega; as passagens ocorrem depois de encerrar o anterior. A coordenação entre duas sessões independentes depende do registro e da disciplina operacional, pois os limites técnicos são por sessão.
- A configuração de projeto evita Fable/Opus na seleção normal do Claude Code compatível e inicia o Codex em Sol. Ela não impede que configurações de maior precedência ou uma seleção explícita alterem o modelo. Um limite obrigatório para toda a conta exige política gerenciada fora do repositório.
- As restrições de leitura declaradas para revisores precisam ser conferidas na sessão efetiva e nos conectores externos. Se não houver isolamento verificável, a revisão deve ocorrer em ambiente de leitura isolado.

## Interrupção e reversão

Se um perfil não carregar, a versão do CLI for incompatível, a seleção de modelos fugir da margem autorizada, um especialista delegar ou um revisor conseguir escrever, interromper o uso do departamento naquele ambiente e registrar a evidência. A reversão do rollout consiste em reverter o commit de configuração e documentação; nenhum dado de produção precisa ser migrado. Não executar uma operação real sensível para testar bloqueios.
