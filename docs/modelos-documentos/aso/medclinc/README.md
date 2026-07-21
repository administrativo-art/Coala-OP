# Guia de encaminhamento para ASO — MedClinic

Modelos de referência fornecidos pela operação para gerar a guia de encaminhamento do ASO admissional.

- Modelo vigente: `guia-encaminhamento-medclinic-v2.docx`
- SHA-256 vigente: `bfdb844b25e018c8e78342c38b435f304becb1cdd38b27c1e10d80f23672133a`
- Modelo anterior preservado: `guia-encaminhamento-medclinc-v1.docx`
- SHA-256 anterior: `4c18e8d8fd125a26ad392acae721f37682e18fcf40f1b121cc4ed35ea05a8383`
- Saída operacional: somente PDF
- Versão de geração vigente: `medclinic-v2`

Os DOCX são referências visuais e documentais imutáveis. O sistema gera o PDF diretamente, salva cada versão no processo e registra hash, data, usuário gerador, versão e o CNPJ utilizado.

## Regras fixas

- Tipo de exame: **Admissional** marcado.
- Programa de exames: **Exames conforme o PCMSO** marcado.
- Forma de pagamento: **PIX**.
- Setor: **Geral**.
- Data do atendimento: **A definir pela clínica** até o retorno do agendamento.
- Nenhum exame individual da grade é marcado pelo Coala One; a definição decorre do PCMSO disponibilizado à clínica.

## Dados populados pelo sistema

- Empresa/CNPJ responsável: snapshot escolhido pelo RH na criação da integração.
- Nome e CPF: formulário de admissão do candidato.
- Função: função da integração; na falta, cargo.
- Autorizado por: permanece disponível para validação/autorização interna.
