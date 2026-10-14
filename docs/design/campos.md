# Campos

- **Input**: 40px, padding 0 12px, raio 10, fundo #faf9f6, borda 1px #dcd9d1, 13px. Foco: borda #5b5bd6, fundo #fff, `0 0 0 3px #eeeefc`.
- **Erro**: borda 1.5px #e11d48; mensagem abaixo, 12/600 #be123c.
- **Textarea**: mesmo estilo, padding 10px 12px, `resize: vertical`.
- **Dropdown / select**: usa o mesmo contêiner do input, com `appearance: none` para remover a seta nativa do navegador. O indicador é um `ChevronDown` de 16px (`strokeWidth` 2,25), centralizado numa área de 32×32px à direita, com raio de 8px, fundo de superfície, borda e sombra leve. O campo reserva 48px à direita para que o texto nunca fique sob o ícone. O chevron é decorativo (`pointer-events: none`); clicar em qualquer ponto do campo continua abrindo a lista.
- **Busca no painel escuro**: 48px, raio 14, fundo rgba(255,255,255,.07), borda rgba(255,255,255,.1), texto #fff 14.5px; ícone de scanner à direita (on-dark-icon).
- **Nome principal no modal**: sem caixa, 28/800, borda inferior de 2px `--ds-ink`; #e11d48 quando vazio.

## Regras
- Rótulo sempre acima, 12/700 #4a4f57. Quando a obrigatoriedade muda por contexto, ela vai escrita no rótulo: "Observações (obrigatório)".
- O erro aparece quando o usuário tenta confirmar e some ao editar o campo.
- O limite relevante fica visível antes do erro: "Quantidade (lata) · disponível 42".
- Unidade junto do número (sufixo dentro do campo ou no rótulo).
- Dropdowns não usam a seta nativa de cada sistema operacional. Foco, erro e estado desabilitado afetam o campo e o contêiner do chevron em conjunto; o ícone não cria um segundo alvo de clique.

## Datas, horários e competências

- Data visível: `DD/MM/AAAA`, por exemplo `13/10/2026`.
- Data e hora visíveis: `DD/MM/AAAA, HH:mm`, sempre em horário local da operação.
- Competência visível: nome do mês por extenso + ano, por exemplo `novembro de 2026`.
- ISO (`AAAA-MM-DD` e `AAAA-MM`) é permitido somente no valor interno de campos, armazenamento, APIs e integrações.
- Textos auxiliares, trilhas, históricos, alertas, tabelas, painéis laterais, modais e documentos não podem interpolar diretamente valores ISO. A conversão deve acontecer na camada de apresentação, inclusive para registros antigos já persistidos.
- Revisões de interface devem testar datas fixas para impedir inversão entre dia e mês e vazamento do formato interno.
