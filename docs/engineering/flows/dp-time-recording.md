# Registro de ponto REP-P

**Estado:** etapas técnicas 1–5 concluídas localmente; etapa 6 com histórico e tela web iniciais e validadas com dados sintéticos; coleta real continua bloqueada por configuração e homologação.

## Superfícies e fronteira

- `POST /api/dp/time-recording/markings`: batida do próprio usuário autenticado. O corpo aceita somente `attemptId`, `workDate`, `executionUnitId` e canal `mobile|browser`.
- `GET /api/dp/time-recording/markings?startDate&endDate`: histórico do próprio usuário, até 62 dias e 300 batidas, lido do catálogo de comprovantes, sem CPF nem bytes.
- `GET /api/dp/time-recording/options?workDate`: unidades de execução do próprio usuário na data, pela abrangência do vínculo histórico; vínculo não CLT/aprendiz devolve lista vazia.
- `GET /api/dp/time-recording/pending-receipts`: monitoração de comprovantes pendentes do workspace (até 100, mais antigos primeiro), para gestor global de Tempo.
- `GET /api/dp/time-recording/signer-status`: validade do e-CNPJ configurado (CNPJ, datas, dias restantes, estado `valid|expiring|expired|invalid|unconfigured`) para gestor global de Tempo; nunca lê nem devolve a chave.
- `GET /api/dp/time-recording/receipts/[receiptId]`: devolve ao próprio colaborador os bytes PDF/PAdES já emitidos daquela batida, sem efeito colateral. Pendente responde `REP_P_RECEIPT_PENDING`.
- `POST /api/dp/time-recording/receipts/[receiptId]`: tenta emitir um comprovante pendente da própria batida, sem registrar nova marcação.
- `POST /api/dp/time-recording/afd`: exportação administrativa por estabelecimento e período, limitada a gestor global de Tempo.
- [`service.server.ts`](../../../src/features/dp/rep-p/service.server.ts): único escritor operacional da ARP; resolve vínculo, identidade e hora, transaciona NSR/original e gera o pacote AFD.
- coleções `repP_*` no banco `coala-rh` (escolha do programador em 18/10/2026 em vez de banco dedicado): `firestore.rh.rules` nega toda leitura e escrita de clientes nessas coleções, inclusive administrador, e o teste de regras comprova. O Admin SDK do serviço é a única fronteira. Isolamento de acesso por banco e raio de estrago ficam menores que num banco próprio; o piloto exige backup agendado, PITR e proteção contra exclusão ligados no `coala-rh` (em 18/10/2026 estavam desligados).

CPF, CNPJ, `employerUnitId`, estabelecimento, NSR, instante e hash nunca vêm do aparelho. A API deriva o empregado do token, lê CPF/nome no RH e resolve o empregador na revisão histórica de vínculo vigente na data. `executionUnitId` precisa constar em `unitIds`; cobertura excepcional mantém `employerUnitId` e CNPJ originais.

```text
usuário autenticado + attemptId + data + unidade de execução
                             │
          vínculo histórico + identidade RH + perfil fiscal ARP
                             │
                 Hora Legal verificada (≤ 30 s)
                             │
             transação: tentativa + NSR + tipo 7 + head
                             │
                 original imutável na ARP (coala-rh)
```

## Etapa 1 — ARP e transação

`repP_establishments` mantém o cabeçalho de sequência por estabelecimento; `repP_events` guarda eventos; `repP_attempts` faz idempotência; `repP_employees` contém a identidade cadastral congelada. A criação da marcação e a atualização de `lastNsr`/`lastType7Hash` ocorrem na mesma transação. O mesmo `attemptId` e conteúdo devolve o original; conteúdo diferente conflita. Tentativas distintas simultâneas recebem NSRs distintos.

Eventos 2 e 5 são produzidos pelo provisionamento administrativo interno. Os serializadores também cobrem 4 e 6. O tipo 3 é exclusivo de outras categorias de REP e permanece com contagem zero no AFD REP-P. A sequência NSR é global por estabelecimento; o hash de um tipo 7 aponta para a marcação tipo 7 anterior, mesmo quando eventos cadastrais ocupam NSRs intermediários.

As regras de cliente são `deny all`. Isso não elimina acesso privilegiado de projeto: IAM do serviço, backups, retenção, detecção de alteração e ensaio de restauração continuam gates operacionais anteriores ao piloto.

## Etapa 2 — API de marcação

A rota usa `secureRoute` diretamente, usuário ativo, escopo de proprietário, corpo estrito, auditoria autoritativa do servidor e replay protegido. Não há parâmetro para marcar por outra pessoa. Jornada, escala, tolerância e autorização de extra não impedem o registro original; pertencem ao PTRP/apuração posterior.

Coletores: `01` para aplicativo móvel e `02` para navegador. O MVP aceita somente modo on-line. Confirmação ocorre apenas depois do commit. A resposta separa `recorded|replayed` de `receiptStatus: available|pending`, com `receiptId` e `receiptIssue`: persistir a batida não finge que o comprovante PAdES já existe.

## Etapa 3 — hora confiável e contingência

O contrato `RepPClock` exige atestação `hlb_verified`, fonte identificada, verificação interna recente e desvio absoluto máximo de 30 segundos. O instante é do servidor e é convertido no fuso IANA do estabelecimento para o formato fiscal `AAAA-MM-DDThh:mm:00±hhmm`; segundos brutos permanecem na evidência técnica da leitura.

Com `REP_P_HLB_NTP_ENABLED=true`, [`hlb-ntp-clock.server.ts`](../../../src/features/dp/rep-p/hlb-ntp-clock.server.ts) consulta por UDP/123 os quatro endereços publicados pelo Observatório Nacional (`200.20.186.75`, `200.20.186.94`, `200.20.224.100`, `200.20.224.101`). Cada resposta precisa ser NTP v3/v4 de servidor, estrato 1–15, ecoar o timestamp da requisição e ter ida e volta de até 1,5 s. A leitura só é aceita com ao menos dois servidores concordando dentro de 1 s; a mediana do grupo determina o desvio. Dois grupos máximos incompatíveis (divisão 2×2) são ambíguos e falham fechados.

Uma atestação válida é reutilizada por 60 s para não consultar a rede a cada batida. Em falha transitória, a última atestação pode sustentar leituras por no máximo 5 min; depois disso o serviço falha fechado. Cada evento guarda o ID/hash da atestação, modo `fresh|cached|fallback`, quórum e amostras por servidor (aceita, descartada ou falha; com offset, RTT e stratum quando recebida). O monitor diário exige consulta `fresh`; cache/fallback não resolve incidente. Sem a variável de ativação retorna `REP_P_TIME_PROVIDER_UNCONFIGURED`; respostas insuficientes, ambíguas, divergentes, vencidas ou com desvio absoluto superior a 30 s retornam `REP_P_TIME_UNAVAILABLE`, sem inserir nada na ARP. Não há fallback para relógio do celular, hora informada pelo usuário ou criação retroativa de batida. Offline permanece fora do MVP.

`REP_P_MARKING_ENABLED` é o gate operacional independente. Em produção ele permanece `false`: a fonte pública pode ser sondada e monitorada, mas o `POST` de marcação recusa antes de qualquer leitura ou escrita na ARP com `REP_P_MARKING_DISABLED`. Só pode virar `true` após decisão formal sobre INPI, os dois atestados, backup/PITR/proteção contra exclusão, validações oficiais e piloto. Essa liberação não é consequência automática de a HLB estar saudável.

A fonte é o serviço público gratuito do ON, não o ReSinc certificado. A página oficial foi conferida em 18/10/2026: [acerte seu computador via internet](https://www.gov.br/observatorio/pt-br/assuntos/areas-de-atuacao/tempo-e-frequencia/acerte-seu-computador-via-internet). ReSinc/HLB certificada continua decisão pendente, sem conclusão de necessidade jurídica. O [contrato de rede do Cloud Run](https://docs.cloud.google.com/run/docs/securing/security#network-security) documenta egress de camada 4 por TCP e UDP, então o transporte é tecnicamente suportado; a saída UDP/123 deste backend App Hosting só estará homologada após sonda na revisão publicada. Falha apenas mantém o bloqueio.

## Etapa 4 — AFD 004 e CAdES

[`afd.ts`](../../../src/features/dp/rep-p/afd.ts) gera arquivo ISO-8859-1 com CRLF, sem linhas vazias internas, cabeçalho tipo 1, eventos 2/4/5/6/7, trailer tipo 9 e marcador de assinatura de 100 posições. Implementa alinhamento/largura fixa, CRC-16/KERMIT para tipos 1/2/4/5, SHA-256 do tipo 7, contagens e nome do arquivo por INPI/CNPJ/REP-P. O vetor CRC oficial `123456789 → 2189` e os comprimentos de todos os registros usados estão testados.

A exportação consulta somente um estabelecimento/workspace e período, limita 2.500 eventos, ordena por NSR, gera os bytes uma vez e envia exatamente esses bytes ao `RepPCadesSigner`. Só aceita CAdES destacado não vazio cujo certificado corresponda ao CNPJ da desenvolvedora CT Sorvetes LTDA; retorna AFD e `.p7s` em base64 no pacote administrativo, com nomes, SHA-256 e contagens. Antes de responder, cria auditoria server-side imutável com período, ator, leiaute, arquivos, hash, certificado e contagens.

O assinador usa o e-CNPJ ICP-Brasil configurado no Secret Manager; sem a variável ou com credencial inválida, falha fechado (`REP_P_CADES_UNAVAILABLE` ou erro específico da credencial). O teste automatizado usa certificado sintético apenas para provar o encadeamento técnico; ele não é certificado nem evidência jurídica. Ainda falta gerar um par real AFD/`.p7s` e validar no serviço oficial do ITI antes do piloto.

## Etapa 5 — comprovante PDF/PAdES

Na mesma transação da marcação nasce `repP_receipts/{establishmentId}_{NSR}` com `status: pending` e um snapshot congelado: título, NSR, data/hora, hash, razão social, CNPJ e CNO/CAEPF do perfil fiscal, local da prestação (endereço de `dp_units` da unidade de execução), registro INPI, CNPJ da desenvolvedora, nome/CPF do RH e coletor. O PDF é sempre derivado desse snapshot, nunca do cadastro atual.

Depois do commit, [`receipt.ts`](../../../src/features/dp/rep-p/receipt.ts) renderiza um PDF determinístico (mesmo snapshot, mesmos bytes; metadados datados pelo instante da marcação) e o envia ao `RepPPadesSigner`. Só aceita PAdES por atualização incremental: bytes originais intactos, `/ByteRange` e `/ETSI.CAdES.detached` na seção acrescentada e certificado com o CNPJ da desenvolvedora. A primeira emissão gravada prevalece; emissão concorrente ou nova tentativa nunca sobrescreve bytes, e a leitura confere o SHA-256 armazenado.

Falha de assinatura, campo legal ausente (`REP_P_RECEIPT_FIELDS_MISSING`) ou erro após o commit deixam o comprovante `pending` com `attempts`/`lastIssue`; a resposta da batida continua de sucesso. A recuperação ocorre por replay do mesmo `attemptId` ou pelo `POST` do comprovante, ambos sem tocar a ARP. Comprovante de outra pessoa responde como inexistente.

## Assinatura ICP-Brasil (e-CNPJ A1)

[`icp-signer.ts`](../../../src/features/dp/rep-p/icp-signer.ts) monta CMS destacado CAdES-BES (contentType, messageDigest, signing-certificate-v2; signingTime só no AFD) com a criptografia nativa do Node e um DER mínimo próprio ([`der.ts`](../../../src/features/dp/rep-p/der.ts)), sem dependência nova. O comprovante é assinado por atualização incremental do PDF (`/Sig` `ETSI.CAdES.detached`, `/ByteRange`, campo `Assinatura REP-P`, reserva de 16 KiB), mantendo os bytes originais. Só carrega credencial cuja chave corresponda ao certificado, com CNPJ ICP-Brasil (otherName 2.16.76.1.3.3 ou sufixo do CN) igual ao da desenvolvedora e dentro da validade; vencido, recusa assinar e o comprovante fica pendente.

A credencial vem de `REP_P_ICP_SIGNER_PEM` (Secret Manager; chave sem senha + certificados em PEM, convertidos do `.pfx` por pipe direto ao `gcloud`). Sem a variável, os assinadores recusam como antes. O segredo foi criado em 18/10/2026 (versão 1, certificado SyngularID PJ A1 válido até 16/06/2027) e liberado ao backend `studio`; o `apphosting.yaml` o referencia nesta branch. Validação independente com certificado de teste: `openssl cms -verify` aceita o `.p7s` e `pdfsig` (Poppler) declara a assinatura do PDF válida e cobrindo o documento inteiro. O vencimento é acompanhado pela [central de avisos](system-notices.md) com marcos de 60 a 0 dias e vencido.

Comprovante real ainda depende da homologação publicada da Hora Legal e da validação oficial da assinatura. O modelo está registrado como `system-rep-p-marking-receipt` em `SYSTEM_DOCUMENT_TEMPLATES` (sem timbre, retenção `manual_review` até a Fase 0). Ainda faltam o checklist campo a campo contra o art. 79/leiaute e as telas de app/web completas (etapa 6). Os bytes ficam no próprio documento Firestore (PDF de poucos KB); mover para armazenamento de objetos é decisão aberta se o tamanho crescer.

## Etapa 6 — histórico e tela web (parcial)

`/dashboard/collaborator/time-recording` (**Meu ponto**) registra a batida pelo canal `browser`, escolhe a unidade de execução entre as do vínculo e reutiliza o mesmo `attemptId` até haver resposta, para que um reenvio após falha de rede devolva a batida já gravada. Depois mostra horário fiscal, NSR e estado do comprovante, com **Baixar comprovante**, **Compartilhar** (folha nativa via Web Share, só quando o navegador aceita arquivos) ou **Tentar emitir comprovante**. O histórico tem Hoje, Dia e Período.

A página não tem link no menu nem no painel do colaborador: a fonte pública de Hora Legal ainda precisa ser publicada e homologada, e os demais gates de uso real continuam abertos. Ligar o atalho somente com esses gates. Falta Coala Go (canal `mobile`), E2E da tela e exportação em lote/pasta do colaborador (etapa 7).

Cada `receiptId` é catalogado com `recordedDate`. Consultas: histórico por `workspaceId+employeeId+recordedDate` e pendentes por `workspaceId+status+createdAt`, ambos com índice em `firestore.rep.indexes.json` e `limit`. Custo: uma consulta por abertura da tela ou troca de período (≤ 300 leituras), sem listener nem polling.

## Evidência de validação

Testes unitários cobrem CRC, larguras, encoding, cabeçalho/trailer, hash adulterado, assinatura incompatível, fuso, tolerância da hora, replay e contratos das rotas/regras. Para NTP, cobrem vínculo resposta/requisição, cálculo de desvio/latência, quórum com 2, 3 e 4 fontes, recusa da divisão 2×2, descarte de divergência, cache, fallback e consulta fresca. Em 18/10/2026, uma sonda fora do sandbox nesta máquina recebeu os quatro servidores como estrato 1, com ida e volta de 66–94 ms e offsets de 93–104 ms; isso prova a viabilidade da fonte, não a saída UDP/123 do App Hosting. O ensaio em Firestore Emulator verifica que o gate global não toca a ARP, cria eventos 2/5, executa duas batidas concorrentes, confirma NSRs 3/4 e evidência HLB estruturada, repete uma tentativa sem duplicar e exporta o AFD contendo os mesmos hashes. O cenário usa unidade de execução distinta da empregadora e confirma que o vínculo não muda. Para o comprovante, unitários cobrem PDF determinístico, campos ausentes, assinatura incremental adulterada/CNPJ errado/SubFilter errado; o emulador confirma batida gravada com comprovante pendente sem assinador, recuperação posterior sem nova batida, bytes preservados em nova tentativa, replay `available` e recusa a outro usuário.

## Bloqueios para uso real

- publicar e homologar a conectividade UDP/123 com os quatro NTPs públicos do ON e simular a perda/retomada; ReSinc certificada permanece pendência não obrigatória por enquanto;
- criar registro INPI, atestados e cadastro fiscal aprovado de cada estabelecimento;
- validar AFD/CAdES e comprovante/PAdES reais no VALIDAR/ITI; carimbo de tempo ACT permanece pendência separada;
- aprovar IAM, retenção, backup imutável, restauração, alertas e contingência;
- ligar Coala Go/Coala One às rotas, histórico e download sem expor AFD multiempregado;
- executar simulação fiscal independente e piloto paralelo ao Bizneo.

Enquanto esses gates não forem concluídos, as rotas falham fechadas e não podem ser usadas para empregados reais.
