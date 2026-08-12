# Distrato de contrato de prestação de serviços

O encerramento PJ por mútuo acordo é um fluxo próprio. Ele não usa ASO, TRCT, cálculo rescisório CLT nem o portal da contabilidade.

## Abertura

O RH seleciona a prestadora, a data do encerramento, o motivo `Encerramento por acordo entre as partes` e o CNPJ da contratante. O servidor exige um onboarding PJ com contrato assinado e confirma que o CNPJ selecionado é o mesmo do contrato de origem.

Na abertura, o processo copia para `pjContractSnapshot`:

- contratante, CNPJ, endereço e representante;
- contratada, CNPJ, endereço e representante;
- data, vigência e valor mensal do contrato original;
- caminho e SHA-256 do contrato assinado;
- cidade da assinatura e foro;
- data da captura.

Alterações posteriores nos cadastros ou no onboarding não modificam esse snapshot. Uma correção do distrato gera nova versão e invalida a versão corrente anterior, sem sobrescrever o histórico.

## Geração

Antes de gerar a versão final, o RH informa:

- dias trabalhados, limitados a 30;
- número e data da nota fiscal;
- data e confirmação do pagamento;
- cidade da assinatura e foro;
- nome, CPF e e-mail de duas testemunhas.

O valor é calculado pelo sistema por trinta avos: `valor mensal / 30 x dias trabalhados`. A geração é bloqueada se o pagamento ainda não tiver ocorrido, porque a cláusula 2.4 contém declaração de recebimento e quitação.

## Revisão e assinaturas

O PDF gerado permanece interno até a revisão do RH. Depois da aprovação, o sistema envia quatro assinaturas pela Autentique:

1. representante da contratante;
2. representante da contratada;
3. primeira testemunha;
4. segunda testemunha.

O webhook arquiva o PDF assinado no dossiê e conclui automaticamente a etapa de assinaturas.

## Fechamento

O encerramento só pode ser concluído depois de:

- distrato assinado;
- nota fiscal e pagamento confirmados;
- acessos revogados;
- materiais devolvidos e eliminação de dados confirmada.

No fechamento, o usuário é inativado, o vínculo jurídico permanece registrado no processo e o contrato original continua preservado pelo caminho e pelo hash congelados.

Para iniciativa unilateral, descumprimento ou término sem acordo, deve ser usado um modelo específico de notificação contratual; o distrato deste fluxo não é aplicável.
