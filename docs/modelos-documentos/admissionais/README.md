# Kit de documentos admissionais

## Estado da implementação

Os nove modelos originais recebidos pela operação em 20/07/2026 permanecem
preservados como versões `v1`. As versões operacionais indicadas neste documento
são matrizes parametrizadas, preparadas por scripts determinísticos e validadas
por renderização.

- Categoria funcional: **Informações admissionais**
- Formato editável: **DOCX**
- Formato oficial: **PDF gerado, timbrado e rastreável**
- Assinatura contratual: **um PDF consolidado**
- Consentimento de imagem e voz: **integrado ao pacote, com opção facultativa explícita**
- Vale-transporte: **dois modelos alternativos e versionados**
- Estado técnico: **implementado**
- Estado de publicação: **homologado e publicado em 30/08/2026**

Os modelos estão com estado `published` no catálogo do sistema e podem ser
selecionados no fluxo admissional. O termo de encerramento continua automático
e não aparece como opção manual.

## Modelos operacionais

| Ordem | Arquivo operacional | SHA-256 | Assinatura |
|---:|---|---|---|
| 1 | `01-contrato-experiencia-v4.docx` | `081e850ded830aef5911c34754ca549313074681be63e7f4f9b204888bedd91f` | Pacote |
| 2 | `02-banco-horas-v2.docx` | `cff1a19adbca0847db5337182e503340edeb590b8786a238c6249be957fe0b32` | Pacote |
| 3 | `03-termo-lgpd-v4.docx` | `c5bc23d9a942b57daeb94d6185187552c4520c82b30cc071f589a9c94d50e1a5` | Pacote |
| 4 | `04-imagem-voz-v4.docx` | `a266bbf3ffa1e4e3fa06108b57f5755879151a1af4e99497ac099d27856d9a0a` | Pacote; autorização facultativa |
| 5 | `05-metas-premios-v2.docx` | `a5662e341eb06b40f01a6db049db18411b94d2bd1d0f74595909eb5ff6624745` | Pacote |
| 6A | `06-vale-transporte-solicitacao-v2.docx` | `cd643a4caf7c088e98af1dc6908cac7d2005163a795f323df1fcd8450fca53bb` | Pacote |
| 6B | `06-vale-transporte-renuncia-v2.docx` | `3ea7e9e3ddbfa2a4ffefe780efbd03677984131e4fdf3ca8437aa81fc3a1a6de` | Pacote |
| 7 | `07-confidencialidade-v2.docx` | `56306e646b241ab3b0bb93c804dc3cf549a833efb583bf990c9a18c8ba275f80` | Pacote |
| 8 | `09-termo-encerramento-v4.docx` | `a98b162a2adfda8856a488870f8a462164a78f7e40ee29f63395f5d0f5e0221e` | Alvo final |

O antigo `08-ponto-eletronico-v2.docx` foi retirado do kit operacional em
30/07/2026. O arquivo permanece somente como registro histórico e não é
oferecido para geração nem incorporado ao pacote admissional.

O termo de encerramento recebe a lista real dos componentes e suas páginas. A
modalidade de vale-transporte é escolhida a partir da decisão vigente; quando a
decisão muda, o documento anterior é marcado como `Substituído`, sem apagar o
histórico.

## Geração e composição

1. O RH seleciona e gera os documentos aplicáveis.
2. O sistema resolve cadastro, empresa responsável, datas e campos manuais.
3. Os valores efetivamente renderizados são gravados em registro de auditoria
   protegido, junto com versões de catálogo e formatadores.
4. Cada DOCX é convertido para PDF e recebe o papel timbrado.
5. O compositor calcula `contentHash`, aplica o rodapé rastreável e calcula
   `artifactHash`.
6. O termo de encerramento é criado com o índice real.
7. Os componentes de escopo `bundle` são consolidados em um PDF, com protocolo
   `ADM`, manifesto e `packageHash`.
8. O pacote é enviado em uma única solicitação à Autentique.
9. O retorno assinado e o relatório do provedor recebem hashes próprios; todos
   os documentos lógicos apontam para o mesmo pacote arquivado.

O rodapé rastreável é aplicado ao PDF, e não ao DOCX, evitando circularidade de
hash e permitindo conhecer a posição real do componente:

```text
Pacote ADM-2026-000184 • Componente 3/8 • Págs. 7–8/23 • Conteúdo 8F2A91C4
```

O código impresso é uma chave de localização. A verificação autoritativa compara
o artefato apresentado com o arquivado pelo sistema.

## Regras especiais

### Consentimento de imagem e voz

O termo integra o PDF único, mas a assinatura do pacote não presume a
autorização: a decisão específica do onboarding é impressa na caixa facultativa
do próprio termo. Caixa sem marcação equivale à não autorização. O sistema
registra concessão, negação e revogação, versão e hash do termo, canal e
evidência da decisão, documento assinado e inventário de usos. Alterações
posteriores podem ser assinadas de forma independente. A revogação bloqueia
novos usos, cria efeito operacional e preserva a prova histórica.

### Vale-transporte

Solicitação e declaração de não utilização são documentos diferentes. Cada
alteração possui versão, data de eficácia, protocolo e chave de idempotência
próprios. O documento anterior fica `Substituído`.

### Experiência de 45/90 dias

O primeiro dia de trabalho conta como dia 1. As datas finais são calculadas pelo
sistema e impressas por extenso. A regra possui testes para virada de mês, ano e
ano bissexto.

O contrato usa CPF e endereço na qualificação, sem PIS/NIT. O salário possui uma
única origem (`integration.monthly_salary`) e o formatador gera, no mesmo campo,
o valor numérico e por extenso. Escala, CBO, horário e local de trabalho vêm dos
cadastros de cargo e lotação; os dados da convenção coletiva vêm da CCT vigente
da unidade. Ausências nessas fontes bloqueiam o documento antes da geração.

ASO, entrega de EPI e treinamentos permanecem como evidências operacionais
separadas. O contrato registra as obrigações gerais de saúde e segurança sem
declarar como recebido algo que dependa desses comprovantes.

## Integridade das fontes

As versões `v1` são a fonte histórica imutável. As versões `v2` são reproduzíveis
pelos scripts:

```bash
node --import tsx scripts/prepare-probation-contract-template.mts
node --import tsx scripts/prepare-hours-bank-template.mts
node --import tsx scripts/prepare-admission-templates.mts
node --import tsx scripts/prepare-admission-closing-template.mts
node --import tsx scripts/prepare-admission-bundle-v4.mts
```

Nenhum modelo é preparado por substituição livre em produção. O construtor com
IA apenas propõe um plano de mapeamento; a aplicação continua sendo
determinística, com hash da fonte e contagem exata de ocorrências.

## Validação de novas versões

A homologação operacional das versões catalogadas foi concluída em 30/08/2026.
Antes de publicar qualquer nova versão:

1. homologar com o RH os textos, o consentimento separado, as duas modalidades
   de vale-transporte e a assinatura única;
2. homologar visualmente Carlito como substituta métrica de Calibri;
3. implantar o Gotenberg reprodutível e executar o canário remoto dos modelos;
4. validar as duas bandas inferiores reservadas para marca e rastreabilidade;
5. executar um pacote real de homologação na Autentique;
6. obter o aceite formal do RH.

Os detalhes técnicos e as pendências externas estão em
[`../../GERADOR-DE-DOCUMENTOS.md`](../../GERADOR-DE-DOCUMENTOS.md).
