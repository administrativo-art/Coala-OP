# Checklist de validação no ITI

Use as amostras geradas por `scripts/rep-p-homologation-samples.mts`. Os serviços oficiais são o [Validar](https://validar.iti.gov.br) (validade da assinatura) e o [Verificador de Conformidade](https://verificador.iti.gov.br) (aderência às políticas ICP-Brasil).

## Comprovante (PAdES)

- [ ] Enviar `AMOSTRA_comprovante-….pdf` ao Validar.
- [ ] Assinatura reconhecida como ICP-Brasil, íntegra, cobrindo o documento inteiro.
- [ ] Signatário: CT SORVETES LTDA, CNPJ 14.276.603/0001-25, certificado dentro da validade.
- [ ] Anotar a política reportada. No PAdES, `signingTime` e `sigPolicyId` não podem estar no SignerInfo (DOC-ICP-15.03); o sistema já não os inclui.
- [ ] Salvar o relatório em PDF.

## AFD (CAdES destacado)

- [ ] Enviar `AMOSTRA_AFD….txt` com o `.p7s` correspondente (assinatura destacada).
- [ ] Assinatura ICP-Brasil íntegra sobre o conteúdo exato do arquivo.
- [ ] Conferir a política reportada: o sistema declara a AD-RB vigente no CAdES, com `sigPolicyId` e `signing-certificate-v2`, ancorada na cópia oficial preservada no repositório. Divergência no Verificador bloqueia o piloto.
- [ ] Salvar o relatório em PDF.

## Responsável técnico (e-CPF)

- [ ] Assinar `AMOSTRA_assinatura-eCPF.pdf` no computador do titular, sem enviar o `.pfx` ou a senha ao sistema.
- [ ] Enviar somente o PDF assinado ao Validar.
- [ ] Conferir cadeia ICP-Brasil, integridade, nome/CPF do titular, qualificação e validade do certificado na data da assinatura.
- [ ] Salvar o relatório em PDF e remover a amostra assinada depois da conferência; o atestado definitivo será assinado separadamente quando estiver preenchido.

## Fechamento

- [ ] Registrar os resultados e os SHA-256 impressos pelo script no registro do chamado.
- [ ] Atualizar o gate 4 no [relatório](README.md#relatório-de-gates).
- [ ] Apagar as amostras locais depois de arquivar os relatórios.
