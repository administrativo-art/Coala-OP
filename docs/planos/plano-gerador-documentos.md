# Gerador de documentos

## Situação verificada e escopo — 02/11/2026

O gerador atual preenche modelos publicados, vincula pessoas/partes, produz prévia, permite aprovação e envia por ação explícita à assinatura. A biblioteca existente aceita DOCX, prepara timbre, mapeia variáveis manualmente ou com IA e controla versões/publicação. Essa IA prepara campos; não é um redator de documentos livres.

Pedido: criar submódulo Gerador de documentos; reaproveitar/melhorar a manutenção de modelos; oferecer criação do zero no timbre, manual ou com auxílio opcional de IA, ou a partir de modelo; permitir vínculo com colaborador/PJ/empresa. Acervo guarda/consulta, Gerador cria, Fluxos acompanha o trabalho. Numeração somente nas pastas principais da empresa; categorias de modelos e dossiês continuam normais.

## Referências e proposta de interação

- [PandaDoc — criação guiada](https://support.pandadoc.com/en/articles/12108203-template-workflow-builder-and-guided-document-creation-full-guide): referência para origem, destinatários, dados faltantes, revisão e envio; editor de uma instância não altera automaticamente o modelo.
- [Clicksign — modelos e variáveis](https://ajuda.clicksign.com/article/121-como-criar-um-modelo-de-documento): referência para reaproveitar o texto e preencher dados por formulário/integração.
- [Docusign — geração documental](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/documents/document-generation/): referência para estrutura formatada, dados personalizados e conteúdo condicional.

Proposta para criação: **origem (do zero/modelo) → contexto (empresa, setor e pessoas) → conteúdo → prévia → aprovação → assinatura ou arquivamento**. Timbrado é do sistema. Selecionar uma pessoa preenche apenas dados autorizados. IA é acionada explicitamente para rascunhar/revisar texto, com resultado conferido pelo usuário; campos oficiais conhecidos são preenchidos mecanicamente. Alteração de instância e publicação de modelo são ações separadas.

## Etapas e aceite

1. **Implementação local em validação:** entrada Gerador no menu, geração existente e manutenção da mesma biblioteca em `/dashboard/documents/generator/models`, com editor individual. Configurações e URLs antigas encaminham ao novo local. Categoria, versão, revisão, timbre e permissões existentes preservados. Sem catálogo duplicado.
2. **Proposta a detalhar:** editor de conteúdo livre com rascunho persistido, paginação/prévia timbrada e salvamento como documento ou como novo modelo por permissões distintas. Antes de desenvolver o gerador persistente, registrar o modelo genérico no catálogo oficial, identidade, versão, setor/nome, retenção, assinatura, arquivamento e publicação. Não derivar retenção/publicação de uma suposição sobre o texto.
3. **Proposta a detalhar:** assistência de redação por IA com prévia do contexto enviado, schema, limites de custo e política de dados; não chamar IA ao digitar, selecionar pessoa ou preencher variável conhecida. Diferenciar texto sugerido de fatos do cadastro; não inventar dados ou enviar para assinatura automaticamente.
4. Validar geração manual/modelo, dados ausentes, permissões, troca de pessoa, timbre multipágina, revisão e imutabilidade após assinatura. Testar com emuladores e transportes simulados antes de qualquer homologação externa autorizada.

A etapa 1 não implementa as etapas 2/3 e não deve apresentar botões que prometam redação livre ou IA ainda inexistentes. A pesquisa e a proposta não autorizam contratação de outros serviços; Autentique continua como integração de assinatura existente.
