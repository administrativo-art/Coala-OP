# Escopo, autorização e evidência

## Regra de engajamento

Antes de qualquer teste dinâmico, registre em `scope.json`:

- branch, revisão e diretório analisados;
- ativos, rotas, serviços e ambientes autorizados;
- contas sintéticas e perfis permitidos;
- operações, métodos HTTP e efeitos de estado permitidos;
- concorrência, taxa e volume máximos;
- dados proibidos e regras de retenção;
- ações proibidas, condição de parada e responsável pela decisão;
- uso permitido de rede, emuladores, navegador e provedores externos.

O padrão é análise estática local. Campo vazio, credencial disponível, sessão autenticada ou acesso técnico não constituem autorização. Produção permanece fora do escopo enquanto não houver autorização específica para alvo, ação e limite; o projeto pode impor proibição mais restritiva.

## Fixação da fonte

Registre a revisão antes da análise. Se arquivos mudarem, identifique a nova revisão/estado e marque quais evidências precisam de nova validação. Não misture resultados de branches ou worktrees sem origem explícita.

## Evidência mínima

Cada afirmação deve apontar para uma destas bases:

- código/configuração com caminho e símbolo;
- resultado de comando com data, escopo e saída sanitizada;
- requisição controlada com identidade, entrada, resposta e efeito persistido;
- documentação oficial datada;
- limitação explícita quando nenhuma delas estiver disponível.

Mantenha os estados distintos: `CONFIRMED`, `POTENTIAL`, `INCONCLUSIVE`, `NOT_TESTED`. Ausência de achado não muda automaticamente uma superfície para validada.

## Proteção da evidência

Não copie valores de `.env`, tokens, cookies, credenciais, documentos pessoais, payloads bancários, dados médicos ou conteúdo integral de RH/financeiro. Registre tipo, localização segura, hash ou trecho redigido somente quando necessário. Evidência que não possa ser sanitizada deve permanecer fora do artefato e ser descrita como restrita.
