# LGPD v5 — validação integrada de geração

Ensaio autorizado em 27/10/2026, na candidata local derivada de `aa746eb7`. Não houve publicação nem escrita em dados reais; os ensaios de geração usaram bancos emulados. A cláusula aprovada e a matriz v5 permanecem inalteradas nesta rodada.

## Resultados

| Cenário | Evidência observada |
| --- | --- |
| Campos obrigatórios | Nome, CPF, razão social, CNPJ e endereço ausentes foram recusados individualmente antes de criar documento |
| Geração da v5 | Motor real de resolução, DOCX, hash, auditoria, Firestore e Storage emulados; cinco campos preenchidos sem tokens pendentes |
| Reenvio | Mesmo ID, DOCX e caminho PDF; nenhuma segunda geração para os mesmos dados/versão |
| Textos longos | Nome e endereço extensos, acentos e `&` preservados; XML válido e PDF legível |
| Conversão efetiva | Serviço oficial Gotenberg recebeu somente documentos fictícios; o backend aplicou o timbrado normal |
| Histórico | Documento v4 marcado como assinado apenas no emulador manteve todos os metadados e hash PDF após nova geração v5 |
| Integridade | Novo pedido com hash do modelo adulterado foi recusado |
| Pacote completo | Oito modelos em ordem canônica, 24 páginas; LGPD v5 nas páginas 7–16; encerramento e assinaturas previstas na página 24 |
| Comparação do conversor | Golden da LGPD atualizado da v2/9 páginas para v5/10 páginas; âncoras de título, seção 3-A, ciência/fundamento e declaração final verificadas; demais entradas preservadas |

O teste tem cinco subcenários integrados, mais o teste agregador: Node informou **6/6 aprovados**, sem testes pulados. A execução final incluiu o pacote completo no conversor oficial. ESLint dirigido, sintaxe do runner e `git diff --check` passaram. Os 18 testes de catálogo e os 22 testes anteriores de composição/assinatura/governança permanecem evidências do mesmo conteúdo e não foram repetidos sem necessidade.

Os PDFs padrão e com dados longos têm dez páginas; ambos foram extraídos e tiveram todas as páginas conferidas visualmente. O pacote foi verificado por manifesto, quantidade, intervalos, conteúdo, limites das páginas e posição das assinaturas. Nenhum documento foi enviado à Autentique: posição de assinatura não equivale a assinatura executada.

A conferência das assinaturas comprova a associação à página 24 e a preservação dos campos; a posição visual final dos selos/rubricas continua sujeita ao editor e à revisão humana prevista no fluxo. Não foi executada aplicação de selo pelo provedor.

## Como repetir isoladamente

```bash
npm run test:integration -- --lgpd-v5
```

Esse modo sobe Firestore/Storage locais no projeto `demo-coala-repository`. O teste recusa credenciais Firebase, host de Storage fora de loopback e bucket diferente de `demo-coala-repository.appspot.com`. Por padrão, usa conversor HTTP local com PDF sintético; comprova o pipeline e não a diagramação do LibreOffice.

Para repetir o ensaio do conversor oficial, definir `LGPD_VALIDATION_REAL_CONVERTER=true`, `DOCX_TO_PDF_URL` e `DOCX_TO_PDF_AUDIENCE` para a URL já estabelecida no `apphosting.yaml`. Essa modalidade usa a autenticação oficial existente do conversor e continua com bancos/arquivos em emuladores. Não definir tokens manualmente. `LGPD_VALIDATION_OUTPUT_DIR` permite guardar os artefatos fictícios numa pasta local privada; os testes não precisam expô-los.

O canário dirigido pode usar `DOCUMENT_CANARY_TEMPLATE_ID=system-admission-lgpd-awareness-term` e o PDF bruto já convertido via `DOCUMENT_CANARY_USE_EXISTING=true`/`DOCUMENT_CANARY_RAW_DIR`. A atualização de golden foi precedida pela verificação do PDF e limitada à entrada LGPD; comparar uma referência recém-atualizada não substitui o ensaio do conversor que a produziu.

## Atenção à seleção da versão na entrega

O gerador dá precedência a `companyDocumentTemplates` quando há um modelo publicado com `storagePath`. No emulador, manter esse registro na v4 continuou gerando v4, mesmo com o catálogo estático v5. Atualizar os metadados e o arquivo desse registro para v5 passou a gerar a candidata, com chave própria e histórico preservado.

Portanto, o deploy do catálogo **não comprova sozinho** a adoção da v5. Antes da publicação, consultar o registro e seu estado de workflow no ambiente de destino. Se existir uma versão armazenada, revisar arquivo, versão, hash, mapeamento, aprovação e caminho; alinhar pelo fluxo de publicação de modelos. Não excluir o registro para forçar fallback e não sobrescrever arquivos históricos. Na conferência posterior autorizada, os dois documentos abaixo foram consultados somente por ID e campos delimitados, no banco `coala` do projeto `smart-converter-752gf`: ambos retornaram inexistentes.

O teste caracteriza a precedência existente; não alteramos silenciosamente a política de modelos personalizados. Não foi necessário alinhar cadastro em banco real: `companyDocumentTemplates/system-admission-lgpd-awareness-term` e `systemDocumentTemplateStates/system-admission-lgpd-awareness-term` não existem no destino consultado. A geração seguirá o catálogo embutido, sem override armazenado. Nenhuma escrita foi feita. Se esse estado mudar antes da entrega, conferir novamente somente esses registros.

## Limites e pendências

- A composição dos oito modelos usa dados demonstrativos; a resolução/cadastro e persistência completas foram exercitadas especificamente para LGPD.
- A primeira expectativa de ordem do teste completo omitia o encerramento automático; foi corrigida no teste, sem alteração do produto. A execução final passou.
- Logs registraram avisos `MaxListenersExceededWarning` do transporte do Storage durante downloads emulados; não houve falha ou supressão dos avisos.
- Não houve teste pelas telas ou envio/assinatura por pessoa real. Nenhuma publicação, migração real, permissão nova ou ativação de localização foi feita.
- Continuam separados: revisão Doc Brown antes do commit, CI/publicação, aditivo dos colaboradores atuais e gates de ativação da localização.

Logs e artefatos privados: `.ai-work/development-technology/rep-p-availability-location/lgpd-v5/`. Emuladores foram encerrados após cada execução.

## Revisão e CI da candidata

A branch local `test/rep-p-availability-location` ainda não tem PR, commit remoto ou execução de CI atribuível a esta candidata. Resultados locais e de conversor não são apresentados como CI aprovado. A revisão obrigatória de Doc Brown fica no registro local do chamado; commit/push/PR não foram executados nesta conferência.

Doc Brown concluiu a revisão da candidata como **CONFORME para commit**, sem bloqueio neste escopo de documentos/testes e sem autorizar ativação. A consulta auditada foi implementada em incremento posterior da candidata local, com revisão própria; sua publicação/ensaio e os gates de privacidade, operação e aparelho permanecem separados. Esse veredito anterior se refere ao escopo LGPD então examinado, sem aprovar automaticamente o incremento.
