# Ensaio local de disponibilidade e localização — 27/10/2026

Base: `aa746eb7`, branch local `test/rep-p-availability-location`. Nenhuma configuração de produção ou dado real foi alterado. O usuário informou aprovação dos quatro blocos anteriores de ensaio com Luis; esse relato é separado dos resultados automatizados abaixo.

## Ambiente e alcance

Node/TypeScript e Firebase Emulator, projeto `demo-coala-repository`, com guard contra credenciais e host externo. Banco fiscal `coala-rep-p` e banco operacional `coala-rh` emulados. Relógio, escala e captura do GPS são entradas sintéticas; transações, concorrência, regras e persistência foram exercitadas no emulador. Dependências existentes foram reaproveitadas, sem instalação.

Esses resultados não comprovam Cloud Monitoring/Pub/Sub publicados, funcionamento do sensor Android, comportamento das telas, permissões do sistema operacional ou aprovação dos documentos de privacidade. Não substituem a revisão final da candidata.

## Verificações

| Bloco | Execução | Resultado |
| --- | --- | --- |
| Disponibilidade/localização unitárias | `node --import tsx --test tests/unit/dp-rep-p-availability.test.ts tests/unit/dp-rep-p-location.test.ts` | 6/6 |
| Ciclo da jornada com banco fake | `node --conditions=react-server --import tsx --test tests/server-unit/dp-rep-p-journey-location.test.ts` | 7/7 |
| Contratos de rotas e isolamento | `node --import tsx --test tests/unit/dp-rep-p-route-contract.test.ts tests/unit/dp-rep-p-rules-contract.test.ts` | 10/10 |
| Disponibilidade e marcação com localização no emulador | `dp-rep-p-availability.test.mjs` e `dp-rep-p.test.mjs`, sequenciais com `--conditions=react-server --import tsx --test` | 9/9 |
| Contingência offline com persistência no emulador | `dp-rep-p-offline.test.mjs` | 2/2 |
| Assinatura offline e configuração do corte oficial | `dp-rep-p-offline.test.ts` e `dp-rep-p-runtime-config.test.ts` | 6/6 |
| Jornada com persistência real no emulador | `dp-rep-p-journey-location.test.mjs` | 1/1 |
| Acesso direto à ARP, políticas e evidências | `node --test --test-name-pattern="ARP do REP-P" tests/security/rules.test.mjs` no emulador | 1/1 |
| Acesso direto à localização da jornada no RH | `node --test --test-name-pattern="localização de jornada" tests/security/rules.test.mjs` no emulador | 1/1 |
| Segurança de exportação e consulta de coordenadas nas APIs com Auth Emulator | `dp-rep-p-api-security.test.mjs` | 12/12 |


Total: **55 testes REP aprovados**, sem testes pulados nas seleções contabilizadas. Cada seleção é contabilizada uma vez, incluindo os subtestes informados pelo runner. ESLint dirigido, verificação dos links de engenharia e `git diff --check` aprovados. A tentativa inicial de regras com o filtro `ARP dedicada` não selecionou o cenário e foi descartada da contagem; o filtro correto foi executado depois.

Os arquivos novos de integração entram no runner `npm run test:integration`. Logs e comandos completos ficam no registro local `.ai-work/development-technology/rep-p-availability-location/`.

### Disponibilidade

- Gate oficial desligado não acessa banco/relógio nem consome NSR.
- Sonda falha quando o banco, relógio ou confiança da hora falham; volta a responder após recuperar as dependências.
- Duas aberturas concorrentes do mesmo incidente produzem somente um evento `08`.
- Dois incidentes simultâneos produzem retorno `07` somente ao fechar o último.
- Reenvio e abertura atrasada após fechamento não duplicam eventos.
- Fechamento recebido antes da abertura preserva o par `08/07`.
- Eventos persistidos geram AFD de teste contendo exatamente a sequência esperada, sem NSR duplicado e sem batidas tipo 7.
- Acréscimo pré-commit: falha ou confiança insuficiente da Hora Legal não grava evento/incidente/estado nem consome NSR; recuperação exige leitura fresca; esgotamento do NSR reverte a transação sem efeito parcial. O arquivo dirigido passou 3/3; a evidência inalterada da marcação foi reaproveitada, totalizando cinco integrações antes dos dois novos cenários de fronteira e concorrência.

Limite: não foi induzida falha no serviço publicado nem na sonda externa. A distinção operacional entre falha da sonda e indisponibilidade do coletor continua exigindo ensaio da implantação; a simulação do serviço não certifica essa configuração.

### Localização pontual e privacidade técnica

- Dentro/fora da área, precisão insuficiente, permissão negada, GPS indisponível, timeout, plataforma sem suporte e captura antiga preservam a marcação.
- Reenvio mantém NSR e não duplica a evidência.
- Pessoa fora da lista não tem coordenada armazenada, mesmo quando um cliente envia posição.
- Retenção/expiração está presente na evidência; coordenadas não entram no original fiscal.
- Ativação sem aviso HTTPS, referência de privacidade, participantes ou confirmação é recusada.
- Configuração fora do escopo de unidade é recusada; alterações autorizadas da política têm auditoria.
- Acesso direto à ARP/políticas/evidências é negado inclusive para cliente administrador.

Importante: exigir campos de configuração não valida o conteúdo ou a aprovação jurídica de um aviso.

### Acompanhamento durante a jornada

- Início → amostra → pausa → retomada → amostra → encerramento persistem corretamente.
- Amostra durante pausa ou depois de encerramento é recusada; reenvio não duplica.
- Revogar política encerra a sessão e reconhece/descarta o lote tardio sem persistir nova coordenada.
- Kill switch solicita parada sem persistir a amostra.

## Correção feita no teste

Os fixtures antigos da marcação oficial e da contingência offline não declaravam `officialUserIds`, exigido pelo gate nominal atual. A primeira execução da marcação parou em `markingEnabled`; o fixture passou a autorizar explicitamente somente a pessoa fictícia e esperar bloqueio para outra identidade. No ensaio offline, duas identidades fictícias estão na allowlist para comprovar que a titularidade da autorização continua sendo exigida mesmo entre participantes habilitados. Nenhum gate do produto foi removido ou alterado.

## Exportação concorrente, autorização offline e corte oficial

- Uma nova batida é persistida depois da primeira página do AFD, dentro da execução da exportação real. A transação somente leitura preserva todos os NSRs do retrato inicial, sem incorporar a batida apenas nas páginas seguintes; a próxima exportação contém o novo NSR exatamente uma vez.
- Uma autorização offline válida de A não pode ser usada por B, por outra chave de aparelho nem por assinatura forjada mantendo o identificador original. As recusas preservam o documento da autorização, o NSR e a ausência de tentativas fiscais de B.
- Depois do corte oficial, uma batida piloto capturada e assinada antes da fronteira ainda pode sincronizar no domínio piloto. Uma nova batida piloto na data oficial é recusada, assim como a tentativa de promover a autorização piloto a oficial.
- O primeiro registro oficial após o corte recebe NSR 3 (após os dois eventos cadastrais). Os quatro registros piloto não consomem NSR fiscal. AFD gerado e insumos reais de AEJ/espelho contêm somente a batida oficial; reenviar a fila piloto não altera esse estado. A verificação do AEJ/espelho cobre os insumos, sem renderizar seus documentos neste cenário.

Execução adicional: os dois arquivos de integração passaram **8/8**, com zero falhas ou saltos, em `rep-final-three.log`. Os unitários de configuração e assinatura passaram **6/6**. Nenhuma alteração no código do produto foi necessária para esses três cenários.

## Pendências reais

1. Publicar/configurar e ensaiar a monitoração externa, inclusive autenticação do relay, retenção/reentrega e falha exclusiva da sonda. Manter coleta oficial desligada.
2. Publicar a consulta auditada de coordenadas e os índices/TTL preparados na candidata local; conferir permissões expressas, IAM e auditoria no destino. Serviço e painel foram implementados; a auditoria da política permanece distinta da auditoria de consulta.
3. Aprovar e disponibilizar cláusula/comunicação, aviso e documentação de privacidade. [Política interna](../privacidade/politica-interna-localizacao.md), [comunicação dos atuais](../privacidade/comunicacao-colaboradores-atuais.md) e [RIPD](../privacidade/ripd-localizacao.md) foram preparados como minutas; configurar participantes, área, raio e turnos reais.
4. Executar o roteiro físico abaixo e revisar a versão candidata antes de ativar coleta real.

## Roteiro restante no Galaxy

Somente após documentos e configuração dos participantes:

| Cenário | Ação física | Conferência |
| --- | --- | --- |
| Posição precisa dentro/fora | Marcar em cada local | Batida aceita, precisão e classificação coerentes; perto da borda pode ser inconclusiva |
| Permissão aproximada | Alterar permissão e marcar | Batida aceita; avaliação conservadora |
| Permissão negada/GPS desligado | Negar/desligar e marcar | Batida aceita, sem coordenadas, sem espera indefinida |
| Captura pontual | Abrir tela sem marcar; depois confirmar batida | Nenhuma captura antes da confirmação |
| Turno com acompanhamento | Iniciar, pausar, retomar e encerrar | Sensor e indicador acompanham o ciclo |
| Tela bloqueada/economia/reinício | Interromper durante a sessão | Observar estado, recuperação e eventual perda de amostras; não presumir continuidade |
| Revogação e desligamento remoto | Revogar participante ou desligar coleta | Serviço/indicador param e lote tardio não grava nova posição |

Registrar versão do APK, participante, unidade, turno, horário, permissão, estado de rede/bateria, resposta na tela e IDs dos registros. Não colocar coordenadas exatas em logs ou capturas compartilhadas. Os ensaios online/offline já aprovados não precisam ser repetidos sem alteração que os afete.

## Ampliação de segurança antes do commit

A [revisão de exportações](seguranca-exportacao-rep-p.md) acrescentou testes de APIs reais com tokens emulados, AFD na meia-noite/paginação e concorrência batida/monitor. Foram corrigidas validação de versão da sessão, precedência do perfil atual e titularidade real nas exportações pessoais em modo suporte. Os testes adicionais de autenticação compartilhada e regressão de privacidade estão discriminados no relatório, sem misturar as contagens.
