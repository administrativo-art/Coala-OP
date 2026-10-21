# Homologação do REP-P

Pacote para levar o REP-P do estado "publicado e bloqueado" à liberação de `REP_P_MARKING_ENABLED`. Nada aqui registra batida nem altera a ARP. Estado em 18/10/2026.

## Relatório de gates

| # | Gate | Estado | Evidência / próximo passo |
| --- | --- | --- | --- |
| 1 | Hora Legal (ON, UDP/123) com quórum e desvio ≤ 30 s | Atendido em produção | `clockState: ok` em 18/10/2026 ([guia do fluxo](../../engineering/flows/dp-time-recording.md)); falta simular perda/retomada publicada |
| 2 | Backup, PITR e proteção contra exclusão do `coala-rh` | Ligados | Conferido em 18/10/2026: PITR e proteção ativos, backup diário com retenção de 98 dias; **restauração ainda não ensaiada** ([roteiro](iam-e-restauracao.md)) |
| 3 | e-CNPJ A1 da desenvolvedora no Secret Manager | Atendido | `REP_P_ICP_SIGNER_PEM` v1, válido até 16/06/2027; vencimento monitorado pela central de avisos |
| 4 | Amostras AFD/CAdES e comprovante/PAdES aprovadas no ITI | Pendente | Gerar com o [script de amostras](#amostras) e seguir o [checklist ITI](validacao-iti.md) |
| 5 | e-CPF A1 do responsável técnico (e do responsável legal, se for outra pessoa) | Pendente (compra) | Fica com cada pessoa; **não** vai ao sistema nem ao Secret Manager ([roteiro](#assinatura-com-e-cpf)) |
| 6 | Atestado Técnico e Termo de Responsabilidade do REP-P | Pendente | [Modelo preenchível](atestados.md#rep-p); depende do INPI (gate 8) |
| 7 | Atestado do PTRP | Bloqueado | O PTRP (apuração) ainda não existe; não atestar programa não implementado |
| 8 | Registro do programa no INPI | Pendente | Número definitivo configura comprovante e AFD (13 dígitos, P&R 49) |
| 9 | IAM revisado (privilégio mínimo sobre `repP_*`) | Pendente, com achado | Conta padrão do Compute com `firebase.admin` alcança a ARP ([inventário](iam-e-restauracao.md#inventário-iam)) |
| 10 | Perguntas ao advogado respondidas | Pendente | [Registro de normas](../referencias/README.md#perguntas-abertas-ao-advogado): preenchimento numérico do AFD é irreversível após a 1ª batida real |
| 11 | Validade das assinaturas e ReSinc | Risco aberto | O e-CNPJ vence em 16/06/2027: sem carimbo do tempo (ACT), AFD e comprovantes de guarda longa podem perder verificabilidade. Decidir sobre ACT e o plano de renovação do e-CNPJ **antes** de ligar a flag; ReSinc/HLB certificada segue como decisão jurídica (gate 10) |
| 11-A | Pré-condições operacionais | Pendente | Cadastro fiscal e local de trabalho aprovados por estabelecimento; política para assinador fora do ar (pergunta 2); retenção e prazo mínimo (pergunta 3); AFD por intervalo e acesso do trabalhador ao comprovante e às últimas 48 h (art. 80 p.ú.) com teste; comunicação ao trabalhador e LGPD |
| 12 | E2E da tela, Coala Go e piloto paralelo ao Bizneo | Pendente | E2E e Coala Go após os gates 4–11-A; o piloto liga a flag para um único estabelecimento, com o Bizneo como registro oficial (pergunta 4) |

`REP_P_MARKING_ENABLED` só pode virar `true` com os gates 1–6, 8–11 e 11-A atendidos (o 7 vale para o PTRP), revisão do Doc Brown e decisão registrada do programador. Ligar a flag é um passo do piloto, não uma decisão posterior a ele: o piloto só existe com a flag ligada, limitado a um estabelecimento e com o Bizneo como registro oficial. As obrigações do art. 80 e do Anexo IX valem desde a primeira batida real.

## Ordem recomendada

1. Comprar o e-CPF A1 do responsável técnico.
2. Responder com o advogado as perguntas do registro de normas, inclusive a acumulação de responsável legal e técnico pela mesma pessoa e se um único e-CPF assina os dois campos.
3. Pedir o registro no INPI.
4. Gerar as amostras e validá-las no ITI.
5. Ensaiar a restauração e revisar o IAM.
6. Com o número definitivo do INPI em mãos, preencher e assinar o atestado do REP-P.
7. Concluir E2E e Coala Go; ligar a flag para um único estabelecimento-piloto; avaliar antes de expandir.

## Amostras

[`scripts/rep-p-homologation-samples.mts`](../../../scripts/rep-p-homologation-samples.mts) gera `AMOSTRA_AFD…REP_P.txt`, o `.p7s` e `AMOSTRA_comprovante-…pdf`. São assinados com o e-CNPJ real, mas com empregador e trabalhador fictícios (`AMOSTRA DE HOMOLOGACAO SEM VALIDADE`, CNPJ 11.222.333/0001-81) e INPI zerado; o PDF traz a faixa "AMOSTRA - SEM VALIDADE". Não leem nem escrevem em banco. O CNPJ e o CPF de exemplo têm dígitos válidos e podem coincidir com pessoas reais (pergunta 7 ao advogado). O INPI zerado não prova o nome do arquivo nem o preenchimento reais.

A credencial passa só pela memória do processo; nada é gravado além das amostras:

```bash
gcloud secrets versions access 1 --secret=REP_P_ICP_SIGNER_PEM --project=smart-converter-752gf \
  | node --import tsx scripts/rep-p-homologation-samples.mts --out ~/amostras-rep-p --confirm-sample
```

A pessoa programadora executa esse comando no próprio terminal: ler o valor do segredo não é tarefa de agente. Use uma pasta fora de diretórios sincronizados (como Desktop/iCloud) e apague as amostras depois de arquivar os relatórios do ITI. O script imprime o SHA-256 de cada arquivo e recusa sem `--confirm-sample` ou com a chave digitada no terminal.

## Assinatura com e-CPF

O e-CPF A1 é pessoal: identifica quem assina o atestado como responsável técnico e, se o advogado confirmar, também como responsável legal. Ele nunca entra no sistema, no repositório ou no Secret Manager.

1. Instalar o `.pfx` só no computador de quem assina (Acesso às Chaves no macOS) e guardar o arquivo e a senha em cofre próprio.
2. Gerar o PDF do atestado a partir de [atestados.md](atestados.md), com todos os campos preenchidos e sem os parênteses de instrução. Esse PDF é o definitivo: qualquer edição depois da assinatura a invalida.
3. Assinar em PAdES com o certificado ICP-Brasil, por exemplo pelo Adobe Acrobat Reader (Ferramentas → Certificados → Assinar digitalmente) ou pelo Assinador SERPRO. Quando houver dois signatários, cada um assina o mesmo PDF em sequência.
4. Validar o PDF assinado em [validar.iti.gov.br](https://validar.iti.gov.br); guardar o relatório junto do atestado.
5. Arquivar o atestado assinado para pronta apresentação à Inspeção do Trabalho e entregar cópia a cada empregador destinatário.
