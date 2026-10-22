# Registro do módulo Coala One — Controle de Ponto no INPI

O INPI **registra o programa de computador**; ele não homologa a conformidade trabalhista do REP-P. Para o piloto, o certificado/número do INPI ainda precisa ser combinado com o atestado técnico do art. 89, as assinaturas ICP-Brasil e os demais gates deste diretório.

Fontes oficiais conferidas em 22/10/2026:

- [serviço Solicitar o Registro de Programa de Computador](https://www.gov.br/pt-br/servicos/solicitar-o-registro-de-programa-de-computador?id=2878&origem=servico);
- [Guia completo de Programa de Computador do INPI](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-completo-de-programa-de-computador).

## O que já está definido

| Campo | Valor |
| --- | --- |
| Nome do programa | `Coala One — Controle de Ponto` |
| Titular | `CT SORVETES LTDA` |
| CNPJ da titular | `14.276.603/0001-25` |
| Natureza do pedido | Registro de programa de computador pelo e-Software |
| Conteúdo técnico | ZIP exato do recorte declarado do módulo em uma revisão Git congelada; o arquivo não é enviado ao INPI, mas deve ser preservado pelo titular |
| Geração do pacote | `node --import tsx scripts/build-inpi-source-package.mts --ref <tag-ou-commit> --out-dir <pasta-segura>` |

O escopo versionado em `config/inpi-controle-ponto-source-scope.json` seleciona somente o núcleo identificador do controle de ponto: REP-P, jornadas e escalas, solicitações que alteram a apuração, banco de horas, ajustes, fechamento, documentos fiscais, geolocalização e coleta móvel. Não inclui os demais módulos do Coala One e não pretende ser uma distribuição compilável isolada.

O gerador lê esse escopo **da própria revisão congelada**, usa somente arquivos rastreados por ela, recusa extensões usuais de certificados/segredos, recria o ZIP para conferir a reprodução, calcula SHA-256 e cria um manifesto com commit, árvore Git, escopo, lista exata de arquivos, tamanhos e hashes. O ZIP final e seu manifesto são documentos confidenciais; não entram no repositório, Drive comum, e-mail ou chamado.

Antes do commit final, o recorte pode ser conferido sem gerar artefato definitivo com `node --import tsx scripts/build-inpi-source-package.mts --check-worktree`.

## Dados que ainda exigem decisão/documento humano

1. Nome civil, CPF, nacionalidade e endereço de cada autor que será declarado.
2. Documento que sustenta a titularidade econômica da CT Sorvetes quando o autor for pessoa física — vínculo empregatício aplicável, contrato de cessão ou outro instrumento conferido pelo jurídico.
3. Data de criação e, se aplicável, data da primeira publicação do programa, baseadas em evidência real.
4. Linguagens e campo de aplicação a declarar. A implementação central usa TypeScript e o coletor Android usa Kotlin; a seleção final deve corresponder ao pacote congelado e às opções do e-Software.
5. Quem apresentará o pedido: a titular com certificado ICP-Brasil adequado ou procurador com procuração válida. O e-CPF pessoal instalado para os atestados não deve ser tratado automaticamente como certificado da pessoa jurídica titular.
6. Tag/commit candidato final. O hash de teste do repositório inteiro foi descartado e não identifica este recorte do módulo.

## Passo a passo operacional

1. Fechar a versão candidata, concluir testes e criar tag/commit imutável.
2. Gerar o ZIP e o manifesto em armazenamento privado; executar novamente para conferir o mesmo SHA-256 e o mesmo manifesto.
3. Guardar duas cópias controladas do ZIP exato e do manifesto. Recompactar muda o hash.
4. Acessar o e-INPI com a conta do requerente e emitir/pagar a GRU do serviço de registro de programa de computador (código 730; conferir o valor vigente no portal antes do pagamento).
5. No e-Software, preencher titular, autores, datas, linguagens, campo de aplicação e o SHA-256 do ZIP preservado.
6. Gerar a Declaração de Veracidade, conferir todos os dados e assiná-la com o certificado ICP-Brasil da pessoa competente. Se houver procurador, anexar a procuração exigida.
7. Protocolar e guardar protocolo, GRU, comprovante de pagamento, Declaração de Veracidade assinada, ZIP, manifesto e certificado final no dossiê controlado.
8. Quando o INPI emitir o registro, configurar o número no REP-P, gerar novamente AFD/comprovante de amostra e preencher o atestado técnico. O número não será inventado nem antecipado com zeros em produção.

## Estado de prontidão

O pedido ainda não está pronto para protocolo porque faltam os dados dos autores/titularidade, datas declaradas, requerente/signatário e a versão candidata final. A infraestrutura para produzir e preservar o conteúdo técnico e seu hash está pronta e testada localmente. O pagamento e o protocolo devem ocorrer somente depois da conferência jurídica desses campos.
