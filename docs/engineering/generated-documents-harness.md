# Harness de documentos gerados

Use este procedimento em qualquer mudança que crie ou altere PDF, DOCX, termo, recibo, declaração, aviso, ordem, relatório, espelho, comprovante ou pacote produzido pelo sistema.

## 1. Classificar a saída

Para cada saída do fluxo, registre no chamado:

| Pergunta | Decisão obrigatória |
| --- | --- |
| O arquivo é persistido, assinado, publicado, reutilizado ou apresentado como oficial? | Se sim, é documento gerado e deve entrar em `SYSTEM_DOCUMENT_TEMPLATES`. |
| É apenas upload de uma instância feita pelo usuário? | Arquive no fluxo de documentos; não crie modelo sem reutilização. |
| É exportação transitória e não preservada? | Documente essa condição no guia do fluxo. Se passar a ser preservada, catalogue. |
| É exceção técnica ou fiscal sem modelo editável? | Use `generationMode: "reference"` e justifique no guia. |

Não use o nome da tela, da rota ou da função para excluir uma saída. Uma “ordem de manutenção”, por exemplo, é documento gerado quando o PDF é preservado como registro oficial.

## 2. Registrar o modelo

Na mesma alteração do gerador, inclua o modelo em `SYSTEM_DOCUMENT_TEMPLATES` com:

- `id` estável e único;
- nome público, categoria e descrição;
- versão e origem (`sourceModule` e `sourceModulePath`);
- `generationMode` correto;
- formato e renderer;
- timbre;
- escopo de assinatura;
- política de retenção;
- variáveis permitidas;
- fonte e hash quando existir arquivo-base.

Modelos `direct` e `contextual` devem aparecer automaticamente em **Configurações → Pessoal → Documentos → Geração e publicação**. Não crie uma lista paralela na interface.

## 3. Conferir segurança e ciclo de vida

- Gerar no servidor com allowlist de dados; não confiar em campos livres enviados pelo cliente.
- Declarar quem pode gerar, revisar, enviar para assinatura, publicar, visualizar e descartar.
- Definir se a publicação ao colaborador é `automatic`, `manual` ou `never` e qual evento a dispara.
- Preservar versão, hash, protocolo, origem e auditoria.
- Tornar webhooks e reconciliações idempotentes.
- Não incluir dados sensíveis que o documento não necessita.
- Falha de assinatura/publicação deve produzir estado recuperável; não apagar o fato de negócio que originou o documento.

## 4. Evidência mínima

Antes do commit:

1. teste unitário do catálogo cobrindo identidade, modo, versão, retenção, assinatura e origem;
2. teste do gerador ou renderer com dados fictícios;
3. teste da política de publicação/assinatura quando aplicável;
4. conferência de que o item aparece em **Geração e publicação**;
5. atualização do guia do fluxo e do registro do chamado;
6. execução de:

```bash
node --import tsx --test tests/unit/generated-documents-settings.test.ts tests/unit/document-system-template-catalog.test.ts
python3 scripts/check-engineering-docs.py
```

Documento persistente gerado sem catálogo, sem decisão de retenção ou sem autorização no servidor bloqueia commit e rollout.
