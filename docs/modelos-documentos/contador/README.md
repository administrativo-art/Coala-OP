# Formulário de admissão para a contabilidade

## Modelo vigente

- Arquivo de referência: `formulario-admissao-contador-v2.pdf`
- Versão: `2.0`
- Status: modelo visual canônico do formulário enviado à contabilidade
- SHA-256: `35796bd807939bd05ada81acc336c194d7044a8075af348f6e8ccc83800cb20d`
- Gerador operacional: `src/features/hr/accountant/admission-form-pdf.tsx`
- Script de reprodução: `scripts/generate-accountant-form-model.tsx`
- Saída operacional: somente PDF

O PDF desta pasta é uma referência visual com dados fictícios. Em cada integração, o sistema gera uma nova versão com os dados efetivos do colaborador e preserva o arquivo gerado para visualização e auditoria.

A versão 2.0 aplica o papel timbrado institucional completo e só pode ser gerada quando a remuneração mensal estiver informada. A versão 1.0 permanece preservada como histórico.

## Conteúdo populado pelo sistema

1. empresa e CNPJ responsáveis pela contratação;
2. nome, CPF, estado civil e escolaridade do colaborador;
3. data de admissão, cargo ou função, salário, contrato de experiência e descanso semanal;
4. jornada de trabalho;
5. análise de salário-família por dependente, contendo nascimento, idade, resultado e a situação nominal de cada documento exigido.

## Regras de salário-família

- O sistema cruza remuneração, idade e documentação aprovada na integração.
- A coluna de documentação deve identificar cada comprovante exigido e indicar se está aprovado ou pendente.
- A conclusão automática é apresentada ao RH antes do envio.
- A contabilidade deve observar a legislação vigente na competência do registro.
- Alterações dos parâmetros legais exigem nova versão do gerador e deste modelo de referência.

## Versionamento e auditoria

- O modelo de referência não deve ser sobrescrito; uma mudança visual ou estrutural gera `v2`, `v3` e assim por diante.
- Cada PDF operacional registra versão do modelo, hash, data, usuário gerador e processo de admissão.
- O formulário deve ficar disponível para visualização e validação do RH antes do envio à contabilidade.
- O envio deve anexar somente a versão validada pelo RH.
