# Coala Go: verificação da instalação por APK direto

Decisão do programador em 27/10/2026: distribuição pelo APK assinado do Coala, sem Google Play Store. A recusa `403` da verificação anterior impedia emitir a autorização offline mesmo quando as opções do ponto respondiam `200` no Galaxy com 0.3.27.

## Protocolo

O app autenticado pede desafio em `GET /api/mobile/app-attestation`. O desafio HMAC identifica o titular, tem propósito próprio, aleatoriedade de 256 bits e validade de cinco minutos. Não grava documento. O Android gera chave P-256 temporária no Android Keystore com o hash do desafio em `setAttestationChallenge`, assina a mensagem do protocolo e envia cadeia/prova em `POST` da mesma rota com `provider=android-key`. A chave temporária é removida após gerar a prova; é diferente da chave duradoura das batidas offline.

O servidor verifica assinatura e validade da cadeia X.509, raiz pelo hash público SPKI fixado, revogação, desafio, conta, prova de posse, níveis TEE/StrongBox, boot verificado/bloqueado, pacote `coalaone.go`, código mínimo da versão e digest SHA-256 do certificado histórico do APK. A extensão de atestação precisa ser a primeira a partir da raiz e corresponder à folha. APK debug, reassinado ou outra aplicação não recebe passe de produção.

O passe HMAC de uma hora continua vinculado ao titular. Sua expiração é fixada no instante assinado do desafio: reenvios simultâneos ou sequenciais da mesma prova devolvem exatamente o mesmo passe, sem renovar ou estender seu prazo e sem persistir nonce em banco. `REP_P_OFFLINE_ATTESTATION_MODE=enforce` exige esse passe na emissão da autorização e na sincronização. Vínculo, perfil, unidades, HLB, boot, fila e separação piloto/oficial mantêm seus gates. A prova Play antiga permanece interpretável para compatibilidade; o cliente novo utiliza exclusivamente a prova de hardware independente da loja.

Há dependência da infraestrutura de certificados de hardware do Android, sem publicação em loja. Aparelho sem cadeia confiável ou boot protegido é recusado. Lista de revogação indisponível impede passe novo; autorização offline já emitida permanece válida nos seus limites.

## Operação e custo

A lista oficial de revogação é consultada por HTTPS com timeout, cache máximo de uma hora (ou `max-age` menor), consolidação das chamadas concorrentes e falha fechada após vencer o cache. Não há polling/listagem Firestore. Cada renovação do passe gera duas chamadas autenticadas; 50 pessoas × 10 renovações por dia × 30 dias resultam em até 30.000 autenticações adicionais/mês. Leituras de usuário dependem do cache central. O cache de revogação é por instância. A autorização de ponto continua sendo renovada no máximo a cada dez horas e vale até 12 horas no mesmo boot.

Permit ausente, vencido ou de outro boot recebe motivo específico na tela. Falha da rede não equivale a dia sem escala/batidas; a finalidade não é pré-selecionada com base em lista vazia fictícia. Pedido de ajuste exige conexão.

## Verificação e fontes

Testes criptográficos usam PKI descartável; teste instrumentado gera prova sem contas de produção. Parâmetros de confiança alternativos são dependências internas de teste, nunca campos da API. O wrapper de produção fixa pacote, certificado e versão mínima oficiais. No Galaxy, a geração/assinatura da prova passou, mas a validação integral local a recusou; o aparelho foi desconectado antes da inspeção e o programador optou por concluir apenas com testes locais. Compatibilidade física e emissão/sincronização reais continuam não confirmadas e impedem declarar o offline homologado.

Fontes consultadas em 27/10/2026: [Android — chaves de hardware](https://developer.android.com/privacy-and-security/security-key-attestation), [AOSP — Key and ID attestation](https://source.android.com/docs/security/features/keystore/attestation), [raízes oficiais](https://android.googleapis.com/attestation/root) e [revogação](https://android.googleapis.com/attestation/status). Os dois hashes SPKI foram conferidos na lista oficial. Esses controles técnicos não substituem a homologação normativa REP-P.
