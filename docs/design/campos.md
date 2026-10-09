# Campos

- **Input**: 40px, padding 0 12px, raio 10, fundo #faf9f6, borda 1px #dcd9d1, 13px. Foco: borda #5b5bd6, fundo #fff, `0 0 0 3px #eeeefc`.
- **Erro**: borda 1.5px #e11d48; mensagem abaixo, 12/600 #be123c.
- **Textarea**: mesmo estilo, padding 10px 12px, `resize: vertical`.
- **Busca no painel escuro**: 48px, raio 14, fundo rgba(255,255,255,.07), borda rgba(255,255,255,.1), texto #fff 14.5px; ícone de scanner à direita (on-dark-icon).
- **Nome principal no modal**: sem caixa, 28/800, borda inferior de 2px `--ds-ink`; #e11d48 quando vazio.

## Regras
- Rótulo sempre acima, 12/700 #4a4f57. Quando a obrigatoriedade muda por contexto, ela vai escrita no rótulo: "Observações (obrigatório)".
- O erro aparece quando o usuário tenta confirmar e some ao editar o campo.
- O limite relevante fica visível antes do erro: "Quantidade (lata) · disponível 42".
- Unidade junto do número (sufixo dentro do campo ou no rótulo).
