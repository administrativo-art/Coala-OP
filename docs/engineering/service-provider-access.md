# Acesso de prestadores de serviço

## Contas e entrada

O diretório de prestadores usa escritórios em `providerOffices` e pessoas em `providerMembers`, no banco principal. Cada pessoa tem UUID imutável no namespace `main.providerMembers`, tipo `service_provider` e perfil `accounting`. O acesso é individual. Cada diretório mantém a identidade da sua própria pessoa.

A gestão fica em `/dashboard/dp/prestadores`, acessível também pelo fechamento do ponto. A API administrativa exige administrador ou permissões de revisão de solicitações e fechamento do RH com acesso a todas as unidades. O modo de visualização de outra conta não permite administrar prestadores.

O RH cadastra o escritório, gera o convite do profissional e compartilha o link de ativação. O token segue no fragmento da URL e seu hash fica no servidor. O profissional define a própria senha em `/prestadores/ativar`. O convite é de uso único e vale 48 horas. A recuperação usa nova emissão pelo RH, invalida a senha e as sessões anteriores e exige confirmação explícita. Um profissional suspenso precisa ser reativado pelo RH antes da nova emissão.

## Autenticação e sessão

O portal em `/prestadores` usa autenticação e providers próprios de prestadores. A senha usa scrypt com sal aleatório. O cookie de sessão é opaco, HttpOnly, SameSite Strict e Secure em produção, com duração de oito horas. O servidor guarda apenas o hash do token e relê a sessão, a pessoa e o escritório em cada autenticação.

O login admite cinco tentativas por e-mail em 15 minutos. Há também orçamento agregado de 30 admissões por minuto antes da derivação de senhas. Mutações públicas exigem a origem da própria página. Suspender e reativar pessoa ou escritório não restaura sessões ou convites anteriores. O encerramento de sessão é independente do limite de novas entradas.

## Empresas e competências

O RH concede acesso por pessoa, empregador cadastrado com CNPJ válido, competência e validade. O identificador da concessão é estável para essa combinação. Renovação e revogação geram eventos. A consulta externa seleciona somente as concessões vigentes do próprio profissional, escritório e workspace. A saída pública projeta identificador, nome e CNPJ da empresa, competência, validade e ID da concessão para os seletores do portal.

A concessão autoriza o escopo da conta. O RH usa “Disponibilizar fechamento por colaborador”, escolhe uma pessoa, confere a prévia e confirma sua liberação. A lista de candidatos, a prévia e a confirmação validam o empregador e todas as unidades do período antes de devolver os dados. A prévia deve corresponder aos hashes de fontes e vínculo enviados na confirmação. Uma repetição com o mesmo requestId preserva a entrega criada.

O portal segue empresa, competência e colaborador. A consulta mostra dias escalados e trabalhados, faltas injustificadas, efeitos das ausências, extras por percentual e destino, descontos em minutos, tempo noturno, créditos e débitos e movimento líquido do banco no mês. A apuração reutiliza o extrato canônico, com aprovações, estornos, limite semanal e vencimentos. Créditos vencidos e banco encaminhado à folha aparecem separados quando a origem não informa percentual de extra. O movimento líquido mensal é identificado com esse nome.

As marcações do espelho são apresentadas em consulta estruturada por dia, com horários incluídos e desconsiderados identificados. O conteúdo entrega dados da própria pessoa e efeitos contábeis das ausências. CPF parcial permite distinguir homônimos. Motivos livres, diagnósticos, tipos médicos, anexos e nomes de terceiros ficam fora desse conteúdo. A consulta estruturada tem finalidade contábil e o espelho fiscal original continua no fluxo oficial.

O RH pode selecionar o contracheque que já esteja vinculado ao pacote da mesma versão. Antes da liberação, o servidor confere PAYSLIP, titular RH recíproco, caso mensal, versão, hash, bytes PDF e limite de 20 MiB. Para esse arquivo mensal indivisível, todos os dias com vínculo publicado no mês precisam corresponder ao empregador da concessão, inclusive dias sem atividade. As datas dos lançamentos enviados também integram a prova do resumo. O download usa o item selecionado e valida novamente autorização e integridade.

A liberação cria uma entrega imutável em `coala-rh/providerClosureReleases` e atualiza o ponteiro `providerClosureAccess` por concessão e pessoa. Fechamento, espelho, apuração, movimentos e extrato são lidos na mesma transação RH. A entrega guarda prova de revisão de vínculo e hash de conteúdo. O acesso confere a sessão, a concessão, o ponteiro vigente, a versão, o vínculo e as fontes financeiras. Reabertura, alteração material na mesma versão, mudança do vínculo ou substituição da entrega suspendem o conteúdo anterior até nova liberação. Versões anteriores permanecem preservadas para auditoria.

`GET /api/service-portal/closures` lista os fechamentos liberados e sua situação. `POST` abre o conteúdo ou baixa o contracheque e registra o profissional, colaborador, entrega e versão em `providerPortalAudit`. O arquivo é devolvido pela API protegida, sem URL de storage. As rotas administrativas correspondentes são `GET/POST /api/dp/service-providers/closures`.

## Dados, auditoria e operação

As coleções de prestadores são privadas ao Admin SDK nas regras do banco principal. A gestão e os atos de autenticação geram registros em `providerPortalAudit`, com responsáveis internos em `actorUid`, atores externos em `actorMemberId` e titular em `memberId`.

O inventário de dados pessoais registra pessoa, sessões, convites, concessões, lookup de e-mail, operações e auditoria. A chave do lookup é hash do e-mail e referencia o UUID da pessoa. Os controles de tentativas contêm contagem, janela e descarte por hash técnico, sem associação canônica a uma pessoa. O inventário, as respostas de gestão e a auditoria devolvem referências e metadados públicos.

As criações usam `requestId` para repetição segura. O token de convite aparece somente na primeira criação. Se a resposta for perdida, o RH usa a emissão explícita de um novo convite. As listagens têm limites de 100 escritórios, 500 profissionais e 1000 concessões, com erro explícito ao ultrapassá-los.

Antes de publicar e provisionar contas reais, implantar as regras, o índice de concessões por workspace/escritório/pessoa/revogação/validade e políticas TTL de `deleteAfter` nas coleções `providerPortalSessions`, `providerPortalInvitations` e `providerPortalLoginAttempts`. A validade é conferida no servidor mesmo antes da remoção pelo TTL. O provisionamento cria a pessoa no diretório de prestadores.

## Verificação

O backend tem testes dirigidos de convite, senha, tentativas, repetição, expiração e revogação. O teste de integração em emulador percorre convite, ativação, login, concessão, logout, suspensão e separação do diretório interno. A verificação visual usa dados simulados para consulta individual, contracheque, confirmação de liberação, versão reaberta e apresentação em celular. O teste de integração do fechamento individual usa o extrato canônico real no emulador e cobre aprovação concorrente, alterações de movimentos, expiração de crédito, vínculo RH e revogação da concessão. A publicação permanece pendente de verificação própria.


## Retorno e conferência pelo RH

A consulta individual é a origem versionada dos eventos usados na conferência interna do contracheque. O RH registra quantidades lidas no PDF devolvido e compara com a entrega, sem ampliar o acesso do prestador. A conferência não depende de incluir contracheque na entrega inicial; isso evita depender de um pacote que ainda não foi enviado para assinatura. Divergência bloqueia novos envios, e alteração de arquivo, remessa ou fechamento exige nova conferência. Veja o [percurso e o escopo de quantidades](flows/dp-time-recording.md#conferência-do-retorno-do-contador-implementação-local-de-23112026).
