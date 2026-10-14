# Solicitações do colaborador

## Pontos de entrada

- Colaborador: `Painel do colaborador → Acessos rápidos → Minhas solicitações`.
- Departamento Pessoal: `Pessoal → Gestão do colaborador → Solicitações`, abaixo de Uniforme e acima de Desligamento.

As duas superfícies usam a mesma solicitação e a mesma trilha. A tela do colaborador prioriza acompanhamento e assinatura; a tela do RH concentra análise, aplicação do benefício e gestão documental.

O card **Minhas solicitações** possui dois alvos independentes: clicar no corpo abre a central e o menu de três pontos abre o catálogo de novas solicitações. O botão **Nova solicitação** da central abre o mesmo catálogo. Enquanto só existe vale-transporte, ele é o primeiro item; novos processos são acrescentados ao catálogo sem alterar o card do painel.

## Vale-transporte

O tipo de ação é contextual:

- sem benefício anterior: **Adesão**;
- benefício ativo: **Alteração** ou **Suspensão**;
- benefício suspenso: **Reativação**, persistida como ação própria e distinta da adesão inicial.

Há somente uma solicitação pendente por colaborador. Alteração e suspensão exigem benefício ativo; reativação exige benefício inativo. Não existe carência fixa entre suspensão e reativação.

O colaborador informa a ação e pode acrescentar motivo e detalhes. Esse texto é opcional; quando preenchido, deve ter ao menos 10 caracteres. A vigência não é escolhida manualmente: o sistema aplica a política de corte e mostra o resultado antes do envio. O valor diário não é informado pelo colaborador; ele é definido pelo RH durante a análise.

### Corte e início de vigência

- solicitações realizadas até o dia 20 entram em vigor no primeiro dia do mês seguinte;
- solicitações realizadas após o dia 20 entram em vigor no primeiro dia do segundo mês seguinte;
- a regra vale para adesão, alteração, suspensão e reativação;
- não há efeito retroativo;
- a data considerada é a data em que a solicitação é enviada no Coala One;
- a análise posterior do RH não altera a competência registrada no envio.
- o aviso anterior ao envio informa também em qual contracheque haverá o reflexo e a data em que ele será pago;
- a data do contracheque segue a regra institucional de pagamento no 5º dia útil do mês posterior à competência e é gravada como snapshot na solicitação.

Exemplos: uma suspensão enviada em 18/03/2026 entra em vigor em 01/04/2026; enviada em 22/03/2026, entra em vigor em 01/05/2026.

Em ambiente local, `?simulation=transport_voucher_suspension` abre uma simulação explicitamente identificada e não persistida. Ela serve para revisar a trilha completa sem criar ou alterar uma solicitação real.

## Trilha e termo

A trilha mínima é:

1. solicitação enviada;
2. aprovação ou rejeição pelo RH;
3. benefício atualizado no cadastro e na projeção do perfil;
4. decisão documental versionada;
5. termo gerado;
6. termo enviado para assinatura;
7. assinatura concluída e documento preservado.

Cada nova adesão, suspensão ou reativação cria uma nova decisão. O termo anterior permanece no histórico e pode ser marcado como substituído; ele nunca é sobrescrito.

O sistema mantém três modelos documentais separados:

- **adesão**, para a primeira opção pelo benefício;
- **suspensão e não utilização**, com pedido expresso de suspensão e concordância com a regra de corte, a vigência calculada, a competência e o contracheque afetado;
- **reativação**, com pedido expresso de reativação e a mesma ciência sobre corte, vigência, competência e contracheque.

Reativação não reutiliza o termo de adesão e não integra o pacote admissional inicial. Os documentos usam `vale-transporte` em minúsculas no corpo, `n˚` para número e uma única lista contínua de informações e compromissos.

Se a geração falhar por falta de dados obrigatórios, a aprovação do benefício é preservada. O pedido recebe o estado **Termo pendente**, exibe a causa e oferece **Gerar novamente** ao RH.

## Assinatura

No detalhe da solicitação, o colaborador pode visualizar o PDF e usar **Revisar e assinar**. A ação cria ou reutiliza o convite individual no provedor de assinatura e abre o acesso exclusivo do próprio colaborador. O RH acompanha o mesmo estado no painel lateral da solicitação e pode reenviar o acesso.

O provedor de assinatura é o **Autentique**. Antes do envio, o DOCX e o PDF gerados ficam em armazenamento privado no Firebase Storage sob `generated-documents/{employeeId}/{generatedDocumentId}/`; os metadados, hashes, versão e situação ficam em `generatedDocuments/{generatedDocumentId}`. O pacote enviado para assinatura e seu manifesto ficam sob `signature-documents/{generatedDocumentId}/{packageId}/`, e a solicitação do provedor é registrada em `hrSignatureRequests/{signatureRequestId}`.

Depois da assinatura, o PDF final é baixado do Autentique e preservado em `signed-documents/generated/{generatedDocumentId}/{signatureRequestId}/signed.pdf`. O sistema cria o registro correspondente em `employeeDocuments`, vincula-o ao colaborador e mantém no documento gerado o hash, a data da assinatura, o identificador do provedor e o caminho arquivado. Para o colaborador, o termo assinado fica disponível em **Painel do colaborador → Meus documentos** e permanece relacionado à solicitação que o originou.

Em uma simulação local, nenhum arquivo é enviado ao Autentique ou gravado no Storage. Os botões **Ver termo de suspensão**, **Ver termo de adesão** e **Ver termo de reativação** abrem diretamente, no visualizador nativo do navegador, PDFs de prévia com dados fictícios. A rota restrita a `localhost` monta esses PDFs a partir do texto do DOCX oficial, sem depender do conversor remoto nem de aplicativos instalados na máquina. O fluxo real continua convertendo o DOCX oficial pelo serviço remoto configurado antes do envio ao Autentique.

## Permissões

O perfil de acesso do DP possui duas permissões específicas:

- **Visualizar solicitações**: consulta os pedidos dentro do escopo de unidades;
- **Analisar solicitações**: aprova, rejeita, tenta gerar novamente o termo e envia para assinatura.

O colaborador sempre acessa somente as próprias solicitações pela permissão do Painel do colaborador.
