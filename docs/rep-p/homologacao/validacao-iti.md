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
- [ ] Conferir a política. O sistema gera CAdES-BES sem `sigPolicyId`. Se o Verificador exigir AD-RB, registrar como "não conforme" para o Doc Brown e implementar a política antes do piloto.
- [ ] Salvar o relatório em PDF.

## Fechamento

- [ ] Registrar os resultados e os SHA-256 impressos pelo script no registro do chamado.
- [ ] Atualizar o gate 4 no [relatório](README.md#relatório-de-gates).
- [ ] Apagar as amostras locais depois de arquivar os relatórios.
