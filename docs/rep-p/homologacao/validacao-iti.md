# Checklist de validação no ITI

Use as amostras geradas por `scripts/rep-p-homologation-samples.mts`. Os serviços oficiais são o [Validar](https://validar.iti.gov.br) (validade da assinatura) e o [Verificador de Conformidade](https://verificador.iti.gov.br) (aderência às políticas ICP-Brasil).

## Comprovante (PAdES)

- [x] Enviar `AMOSTRA_comprovante-….pdf` ao Validar.
- [x] Assinatura reconhecida como ICP-Brasil, íntegra, cobrindo o documento inteiro.
- [x] O relatório reconhece a certificação DocMDP com permissão `P=1` (nenhuma alteração permitida) e não classifica o resultado como indeterminado por ausência de DocMDP/FieldMDP.
- [x] Signatário: CT SORVETES LTDA, CNPJ 14.276.603/0001-25, certificado dentro da validade.
- [x] Anotar a política reportada. No PAdES, `signingTime` e `sigPolicyId` não podem estar no SignerInfo (DOC-ICP-15.03); o sistema já não os inclui.
- [x] Salvar o relatório em PDF — [evidência arquivada](evidencias/2026-10-25/README.md).

## AFD (CAdES destacado)

- [x] Enviar `AMOSTRA_AFD….txt` com o `.p7s` correspondente (assinatura destacada).
- [x] Assinatura ICP-Brasil íntegra sobre o conteúdo exato do arquivo.
- [x] Conferir a política reportada: o sistema declara a AD-RB vigente no CAdES, com `sigPolicyId` e `signing-certificate-v2`, ancorada na cópia oficial preservada no repositório. Divergência no Verificador bloqueia o piloto.
- [x] Salvar o relatório em PDF — [evidência arquivada](evidencias/2026-10-25/README.md).

## Responsável técnico (e-CPF)

- [x] Assinar `AMOSTRA_assinatura-eCPF.pdf` no computador do titular, sem enviar o `.pfx` ou a senha ao sistema.
- [x] Enviar somente o PDF assinado ao Validar.
- [x] Conferir cadeia ICP-Brasil, integridade, nome/CPF do titular, qualificação e validade do certificado na data da assinatura.
- [x] Salvar o relatório em PDF — [evidência arquivada](evidencias/2026-10-25/README.md).
- [ ] Remover a amostra assinada depois da conferência; o atestado definitivo será assinado separadamente quando estiver preenchido.

## Fechamento

- [x] Registrar os resultados e os SHA-256 no pacote de [evidências arquivadas](evidencias/2026-10-25/README.md).
- [x] Atualizar o gate 4 no [relatório](README.md#relatório-de-gates).
- [ ] Apagar as amostras locais depois de arquivar os relatórios.
