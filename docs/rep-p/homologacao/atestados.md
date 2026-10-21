# Atestados (modelo oficial do MTE)

Modelo preenchível com os rótulos do [modelo oficial](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf) (sha256 `3f984eb17f86694da60a506dd0bb2ff1c55ff6f1d1fcb533400957845d6b9659`, conferido em 18/10/2026; base: art. 89 da Portaria MTP nº 671/2021). Os campos da CT Sorvetes já estão preenchidos; campos entre `⟨ ⟩` dependem de decisão ou registro ainda pendente. O texto declaratório não deve ser alterado. "Responsável técnico e legal da empresa" refere-se à CT Sorvetes como desenvolvedora do REP-P (pergunta 6 do registro de normas).

Confirmar com o advogado antes de assinar: acumulação de responsável legal e técnico pela mesma pessoa; um atestado por empregador destinatário ou um pela matriz (P&R 43); e se o número de registro e o certificado do INPI são o mesmo identificador.

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
> Assinatura Eletrônica: (somente REP-C) — ⟨decisão: preencher "N/A"; confirmar com o advogado⟩
> Chave pública: ⟨N/A, se confirmado⟩
> Algoritmo de criptografia assimétrica: ⟨N/A, se confirmado⟩
> Algoritmo de hash: ⟨N/A, se confirmado⟩
>
> Declaramos ainda, que estamos cientes das consequências legais, cíveis e criminais, quanto à falsa declaração, falso atestado e falsidade ideológica. Reiteramos ao usuário que este documento deve ficar disponível para pronta apresentação para a Inspeção do Trabalho.
>
> Empresa/Pessoa Destinatária:
> Razão Social: ⟨empregador usuário, ex.: CT SORVETES LTDA⟩
> CNPJ/CPF: ⟨CNPJ do empregador usuário⟩
>
> ⟨Nome e CPF do Responsável Legal⟩
> ⟨Nome e CPF do Responsável Técnico⟩

O bloco de assinatura eletrônica é do REP-C; no REP-P, AFD e comprovante são assinados com o certificado ICP-Brasil da desenvolvedora (art. 88). Preencher esse bloco com `N/A` é interpretação, a confirmar.

O modelo oficial também aceita `N/A` no certificado de registro do INPI e na versão. Este pacote opta por não usar `N/A` nesses campos (decisão a validar com o advogado). Cada publicação nova da `production` muda a versão: até o advogado dizer se o atestado vale por versão ou pelo programa, registrar no atestado a versão vigente e emitir outro a cada mudança relevante do REP-P.

## PTRP

Bloqueado: o programa de tratamento (apuração, Fase 3) ainda não existe. Quando existir, usar o mesmo modelo com `Tipo do REP/PTRP: PTRP`, `Identificador do Programa: Coala One PTRP`, registro e certificado do INPI do PTRP (ou `N/A`, se o advogado confirmar que não se aplica), a versão do PTRP e os mesmos campos de destinatário e signatários.
