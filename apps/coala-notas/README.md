# Coala Notas

Aplicativo Android do Coala One para registrar compras locais já pagas e recebidas. A colaboradora fotografa a nota, revisa os dados e itens extraídos, escolhe unidade e origem do recurso e confirma o registro.

Quando a origem é sangria, a compra aguarda o movimento real do PDV e aparece como candidata no fechamento do mesmo dia, unidade e valor. Ela não fica visível como uma segunda despesa comum. A compra normal entra no fluxo financeiro com Pix/conta, cartão, boleto, prazo ou dinheiro corporativo.

## Fluxo do aplicativo

1. A pessoa informa o tipo da compra: **Sangria** ou **Compra normal**.
2. Em Sangria, anexa somente a nota. Em Compra normal, anexa obrigatoriamente a nota e o comprovante de pagamento.
3. O sistema analisa os documentos em uma única chamada, mantendo nota e comprovante em papéis distintos. A pessoa finaliza o preenchimento e revisa o meio de pagamento identificado antes de registrar.

O comprovante nunca substitui dados fiscais da nota. Divergências de valor ou favorecido são exibidas para revisão e um método não comprovado permanece não identificado, sem inferência silenciosa.

## Simulação e uso offline

- O modo de simulação não chama autenticação, API, IA, banco ou Storage.
- No modo real, a fila offline exige login, fica no diretório privado do app e é vinculada ao UID que capturou os documentos.
- Nota e comprovante são preservados juntos com o mesmo `submissionId`. A cópia local só é excluída depois da confirmação do servidor.
- O backup Android está desativado, e o aplicativo não solicita permissão de microfone.

## Configuração local

1. Copie `.env.example` para `.env.local` e mantenha `EXPO_PUBLIC_API_BASE_URL` apontando para o ambiente desejado.
2. Instale as dependências com `npm install` dentro desta pasta.
3. Execute `npm run start` e abra em um dispositivo Android com Expo Go, ou `npm run android` com emulador local.

As chaves `EXPO_PUBLIC_FIREBASE_*` identificam o projeto Firebase e são públicas por natureza. Autorização efetiva continua no token e no servidor. Não coloque contas, senhas, service accounts ou outros segredos no arquivo de ambiente.

## Gerar APK de distribuição interna

O perfil `preview` do `eas.json` gera APK instalável diretamente:

```bash
npx eas-cli login
npm run build:apk
```

O build remoto exige conta Expo e configuração inicial do projeto. Como alternativa, com Android SDK/JDK configurados, use `npx expo prebuild --platform android` e gere localmente pelo Gradle. Nenhum desses comandos publica na Play Store.

## Permissão no Coala One

O perfil do usuário precisa de `app.localPurchase.register`. Essa permissão não concede acesso para visualizar a caixa financeira, criar despesas livremente, classificar sangrias ou operar pagamentos.

## Limite atual

Os itens confirmados ficam vinculados à compra, mas esta etapa ainda não cria lotes nem movimentos de estoque. Antes disso, cada linha precisa ser vinculada com segurança ao insumo/produto e à conversão de unidade existente no Coala One.
