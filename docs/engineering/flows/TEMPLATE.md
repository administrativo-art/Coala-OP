# Nome do fluxo e ação concreta

**Estado:** localizado / traçado / verificado. **Base:** commit e data do checkout. Este arquivo descreve comportamento implementado; decisões aprovadas ficam em [regras de negócio](../business-rules.md).

## Escopo e entradas

- Qual ação inicia o fluxo, em qual tela e para qual ator.
- Páginas relacionadas na [matriz](../flow-matrix.csv); entradas alternativas e redirecionamentos.
- O que fica fora deste fluxo e em qual outro guia está.

## Percurso observado

Descrever em ordem interface → chamada/ação → validação e autorização no servidor → serviço → leitura/escrita → resposta/estado apresentado. Cada passo cita arquivo e função; separar chamadas síncronas, jobs, webhooks e efeitos externos.

## Dados e acesso

| Dado ou coleção | Operação | Fonte | Quem pode ler/alterar e onde é verificado |
| --- | --- | --- | --- |
| A confirmar | A confirmar | Arquivo/função | Rota, serviço e regra aplicável |

Registrar schema, validações, escopo de unidade/colaborador e dados sensíveis. Visibilidade de botão não comprova autorização.

## Dependências e contratos

- Consumidores, integrações, eventos e outros módulos afetados.
- Estados e transições que precisam ser preservados.
- Fronteiras de consistência: transação, bancos diferentes, Storage, e-mail, banco ou API externa.

## Verificação e limites

- Testes existentes relevantes e o que eles realmente cobrem.
- Comandos executados, resultado e verificações ainda necessárias.
- Fatos não confirmados, inferências marcadas e divergências com [regras aprovadas](../business-rules.md).

Marque **traçado** quando todos os passos e dependências conhecidos tiverem fonte. Marque **verificado** após conferir acesso, dados e testes pertinentes. Não preencha lacunas com suposição.
