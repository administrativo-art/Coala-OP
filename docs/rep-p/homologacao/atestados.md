# Atestados (modelo oficial do MTE)

Modelo preenchível com os rótulos do [modelo oficial](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf) (sha256 `3f984eb17f86694da60a506dd0bb2ff1c55ff6f1d1fcb533400957845d6b9659`, conferido em 18/10/2026; base: art. 89 da Portaria MTP nº 671/2021). Os campos da CT Sorvetes já estão preenchidos; campos entre `⟨ ⟩` dependem do INPI, da versão final ou do signatário. O texto declaratório não deve ser alterado.

Papéis definidos: **CT SORVETES LTDA é a pessoa jurídica desenvolvedora do REP-P e a empregadora destinatária no uso próprio**; **TIAGO FRANCISCO BRASIL BATISTA é o responsável técnico**. O modelo oficial também pede nome e CPF de quem assina como responsável legal da empresa. Esse signatário é uma pessoa física com poderes de representação da CT Sorvetes; a assinatura pessoal não muda o fato de que a responsabilidade institucional e a titularidade pertencem à empresa. Não existe uma confirmação separada para a CT Sorvetes “também ser desenvolvedora”: a consistência entre CNPJ, titularidade do INPI, certificado da assinatura e atestado é a própria formalização.

Decisão registrada em 23/10/2026: a mesma pessoa pode constar nos dois papéis quando também tiver poderes de representação e assinar os campos aplicáveis com seu e-CPF. O e-CPF de Tiago já teve uma amostra aprovada no VALIDAR/ITI em 25/10/2026; isso comprova o mecanismo de assinatura, mas o atestado definitivo será assinado somente depois de preenchidos INPI e versão. Emitir o atestado para o empregador destinatário; a matriz pode abranger seus estabelecimentos conforme a P&R 43, enquanto empregadores distintos recebem documentos próprios. No documento final, preencher o número e o certificado do INPI, sem `N/A` nesses campos.

## REP-P

> **ATESTADO TÉCNICO E TERMO DE RESPONSABILIDADE**
>
> Na qualidade de responsável técnico e de responsável legal da empresa CT SORVETES LTDA, CNPJ nº 14.276.603/0001-25, os signatários abaixo, em atenção ao art. 89 da Portaria MTP nº 671/2021, atestam e declaram que o equipamento e/ou programa identificados abaixo estão em conformidade com a Portaria MTP nº 671/2021.
>
> Tipo do REP/PTRP: REP-P
> Marca Equipamento: N/A
> Modelo Equipamento: N/A
> Certificado de conformidade: N/A
> Número de fabricação: N/A
> Número de registro no INPI: ⟨número do INPI, só dígitos⟩
> Certificado de registro de programa de computador no INPI: ⟨certificado do INPI⟩
> Identificador do Programa: Coala One REP-P
> Versão do Programa: ⟨versão publicada no momento do atestado, ex.: commit/tag da `production`⟩
>
> Assinatura Eletrônica: (somente REP-C) — N/A
> Chave pública: N/A
> Algoritmo de criptografia assimétrica: N/A
> Algoritmo de hash: N/A
>
> Declaramos ainda, que estamos cientes das consequências legais, cíveis e criminais, quanto à falsa declaração, falso atestado e falsidade ideológica. Reiteramos ao usuário que este documento deve ficar disponível para pronta apresentação para a Inspeção do Trabalho.
>
> Empresa/Pessoa Destinatária:
> Razão Social: ⟨empregador usuário, ex.: CT SORVETES LTDA⟩
> CNPJ/CPF: ⟨CNPJ do empregador usuário⟩
>
> ⟨Nome e CPF do Responsável Legal⟩
> ⟨Nome e CPF do Responsável Técnico⟩

O bloco de assinatura eletrônica é do REP-C; no REP-P, AFD e comprovante são assinados com o certificado ICP-Brasil da desenvolvedora (art. 88). Por isso, os campos exclusivos do REP-C ficam como `N/A`.

Embora o modelo oficial admita `N/A` no certificado de registro do INPI e na versão, este pacote não usa `N/A` nesses campos. Registrar a versão candidata congelada e emitir outro atestado a cada mudança material do REP-P.

## PTRP

Pendente de homologação integrada: tratamentos, fechamento, espelho, AEJ e banco de horas já existem, mas o atestado só deve ser emitido depois de congelar e validar a versão candidata completa. Usar o mesmo modelo com `Tipo do REP/PTRP: PTRP`, `Identificador do Programa: Coala One PTRP`, registro e certificado do INPI conforme aplicáveis ao PTRP, a versão do PTRP e os mesmos campos de destinatário e signatários. Eventual campo não aplicável deve seguir o modelo oficial ou uma orientação técnica da SIT, sem transformar isso em gate jurídico genérico do REP-P.
