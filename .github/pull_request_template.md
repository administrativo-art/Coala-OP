## O que muda e por quê


## Checklist de design (docs/design/README.md)
- [ ] Usei tokens e variantes existentes (sem hex solto no componente).
- [ ] Uma ação principal por área; rótulos no formato verbo + objeto.
- [ ] Ação destrutiva afastada e com confirmação inline.
- [ ] Erros em texto junto do campo; sem `alert`/`confirm`/`prompt` no código novo.
- [ ] Se migrei uma tela real, anexei capturas e preenchi `docs/design/validacao-visual.md`.
- [ ] Linhas clicáveis usam `LiftRow` e abrem `SidePanel`.
- [ ] Estados de carregando, vazio e sem resultados tratados.

## Checklist de segurança de API

- [ ] Se alterei ou criei `src/app/api/**/route.*`, todos os métodos exportados usam `secureRoute` ou há exceção temporária delimitada e justificada.
- [ ] Testei o cenário legítimo e a tentativa indevida pertinente; não tratei a declaração do enforcer como prova comportamental.
- [ ] Executei `npm run check:security-contracts` e revisei o inventário gerado.
