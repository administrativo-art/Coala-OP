# Formulário de admissão para a contabilidade

## Modelo vigente

- Arquivo de referência: `formulario-admissao-contador-v1.pdf`
- Versão: `1.0`
- Status: modelo visual canônico do formulário enviado à contabilidade
- SHA-256: `7f34b7dd9ed5453d3e1579bda8aab3f70859dd694055e6e3ddd810f89427d32c`
- Gerador operacional: `src/features/hr/accountant/admission-form-pdf.tsx`
- Script de reprodução: `scripts/generate-accountant-form-model.tsx`
- Saída operacional: somente PDF

O PDF desta pasta é uma referência visual com dados fictícios. Em cada integração, o sistema gera uma nova versão com os dados efetivos do colaborador e preserva o arquivo gerado para visualização e auditoria.

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
