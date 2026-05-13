# Implantações Futuras

## Link externo para envio de despesas, compras e cotações com IA

### Objetivo

Criar um link externo seguro para colaboradores enviarem prints, comprovantes, PDFs, extratos, fotos de notas e outras evidências sem precisar acessar o sistema completo. O sistema deve receber o material, processar com IA e criar rascunhos para revisão interna.

### Fluxo previsto

1. O colaborador acessa um link externo com token.
2. Informa dados mínimos: nome, unidade, tipo da solicitação e observação.
3. Envia um ou mais arquivos.
4. O sistema cria uma solicitação em fila com o arquivo bruto preservado.
5. A IA extrai e classifica os dados.
6. O sistema cria apenas rascunhos:
   - sessão diária de despesas com origem `ai_assisted` / `external_upload`;
   - cotação com status `draft`;
   - compra com status `created`;
   - item marcado como `needs_review` quando faltar informação.
7. Um usuário interno revisa e finaliza no fluxo normal.

### Regras de segurança e auditoria

- Nunca finalizar despesa, compra ou cotação automaticamente.
- Guardar o arquivo original para conferência.
- Registrar origem da solicitação: `external_upload`.
- Registrar origem do processamento: `ai_assisted`.
- Manter status da solicitação: `received`, `processing`, `draft_created`, `needs_review`, `rejected`.
- Separar permissões do link externo das permissões internas do sistema.

### Provedor de IA

Implementar a integração por adaptador para permitir troca de provedor:

- `provider: "openai" | "gemini"`
- Começar preferencialmente com Gemini Flash-Lite/Flash para custo baixo.
- Usar modelo mais forte apenas em exceções: PDFs ruins, extratos grandes ou documentos ambíguos.

### Estimativa de custo

Implementação MVP: 7 a 14 dias de desenvolvimento.

Custo mensal de IA estimado:

- 100 documentos/mês: abaixo de US$ 1-3.
- 1.000 documentos/mês: cerca de US$ 3-20.
- 10.000 documentos/mês: cerca de US$ 30-200.

O custo principal tende a ser desenvolvimento e manutenção, não o consumo de IA.

### Decisão pendente

Decidir depois:

- se o processamento será automático via API ou assistido manualmente;
- se o provedor inicial será Gemini ou OpenAI;
- quais usuários externos poderão receber link;
- se cada unidade terá link próprio ou se o formulário pedirá a unidade;
- política de retenção dos arquivos enviados.
