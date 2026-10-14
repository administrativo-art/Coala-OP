# Validação dinâmica local

Execute somente quando `scope.json` autorizar testes dinâmicos locais e definir os alvos.

## Ambiente permitido

- Firebase Emulator Suite com projeto prefixado por `demo-`;
- aplicação local iniciada pelos scripts do repositório;
- Playwright do próprio repositório contra o app local;
- contas, workspaces, unidades e registros sintéticos criados pelo teste;
- chamadas HTTP locais limitadas e reproduzíveis.

Antes de iniciar, confirme que credenciais reais de Firebase/GCP estão ausentes. Os scripts de segurança e E2E do repositório devem falhar fechados quando detectarem credenciais proibidas. Não substitua esse controle por confiança manual.

## Método por hipótese

1. Declare ameaça, controle esperado e condição de sucesso/falha.
2. Execute o cenário legítimo e registre resposta e estado.
3. Execute uma tentativa indevida com outra identidade, escopo ou entrada.
4. Verifique resposta, efeito persistido, auditoria e vazamento lateral.
5. Repita somente o necessário para descartar flutuação; respeite taxa e concorrência do escopo.
6. Classifique como proteção validada no cenário, vulnerabilidade confirmada, potencial, inconclusiva ou não testada.

HTTP 200 não comprova alteração indevida; HTTP 401/403 não comprova proteção do fluxo inteiro. Confira persistência e dados retornados. Testes que alteram estado devem ser idempotentes ou possuir limpeza determinística dos dados sintéticos.

## Proibições

Não use produção, projetos Firebase reais, Chrome/sessões do usuário, credenciais reais, força bruta, DoS, scanners de rede, serviços bancários, Meta, Bizneo ou outros provedores externos. Uma futura autorização deve nomear alvo e operação e ainda respeitar `AGENTS.md`.

Pare ao detectar acesso a dado real, alvo inesperado, credencial ativa, efeito fora do fixture, taxa não prevista ou divergência entre configuração e escopo.
