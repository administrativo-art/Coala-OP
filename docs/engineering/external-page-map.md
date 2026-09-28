# Páginas fora do dashboard: destino de investigação

Este mapa manual liga as **20 páginas** do [inventário gerado](surface-inventory.md) aos fluxos que devem ser abertos em uma investigação. É classificação de entrada, não prova de que autenticação, tokens ou dados estejam corretos. As APIs correspondentes precisam ser conferidas no código antes de mudar comportamento.

| Página | Caminho de investigação | Papel observado / limite |
| --- | --- | --- |
| [`/`](../../src/app/page.tsx) | [Recrutamento](flows/recruitment.md), [página inicial](flows/platform-home.md) | `RootHostSwitch` ou página de vagas conforme host; verificar resolução de host. |
| [`/aso/candidato/[token]`](../../src/app/aso/candidato/%5Btoken%5D/page.tsx) | [ASO de integração](flows/onboarding-aso.md) | Consulta e upload por token via `/api/hr/aso/candidate/[token]`. |
| [`/aso/clinica/[token]`](../../src/app/aso/clinica/%5Btoken%5D/page.tsx) | [ASO de integração](flows/onboarding-aso.md) | Agendamento por clínica via `/api/hr/aso/clinic/[token]`. |
| [`/catalogo`](../../src/app/catalogo/page.tsx) | [Catálogo](flows/catalog.md) | `CatalogoView`; conferir acesso à API. |
| [`/contador/ficha-registro/[token]`](../../src/app/contador/ficha-registro/%5Btoken%5D/page.tsx) | [Contador da integração](flows/onboarding-accountant.md) | Upload da ficha via `/api/hr/accountant/[token]`. |
| [`/desligamento/contabilidade/[token]`](../../src/app/desligamento/contabilidade/%5Btoken%5D/page.tsx) | [Contador do desligamento](flows/termination-notice-accountant.md) | Resposta externa por token. |
| [`/desligamento/documentos/[token]`](../../src/app/desligamento/documentos/%5Btoken%5D/page.tsx) | [Documentos do desligamento](flows/termination-audit-payment-closure.md) | Entrega/consulta externa de documentos. |
| [`/document-preview/[id]`](../../src/app/document-preview/%5Bid%5D/page.tsx) | [Geração de documentos](flows/document-generation.md) | Prévia de documento; conferir checagem de acesso. |
| [`/escala`](../../src/app/%28modules%29/escala/page.tsx) | [Escalas DP](flows/dp-schedules.md) | `EscalaView`; conferir se a rota é pública ou exige sessão. |
| [`/ferias/contabilidade/[token]`](../../src/app/ferias/contabilidade/%5Btoken%5D/page.tsx) | [Contador de férias](flows/vacation-accountant-dispatch.md) | Recibos/retorno por token. |
| [`/forgot-password`](../../src/app/forgot-password/page.tsx) | [Acesso e privacidade](access-and-privacy.md) | Limite por hash de e-mail, Auth, envio e registro em etapas distintas; recuperação externa não homologada. |
| [`/login`](../../src/app/login/page.tsx) | [Acesso e privacidade](access-and-privacy.md), [pessoas](flows/people-access.md) | Sessão, bloqueios e retorno; autenticação não substitui permissão da operação. |
| [`/patrimonio/[code]`](../../src/app/patrimonio/%5Bcode%5D/page.tsx) | [Patrimônio](flows/assets.md) | Consulta pública por código e histórico via Admin SDK nesta base; login/permissão aprovados ainda não implementados. Ver [patrimônio](flows/assets.md). |
| [`/player`](../../src/app/player/page.tsx) | [Sinalização](flows/signage.md) | Player de sinalização. |
| [`/primeiro-acesso/[token]`](../../src/app/primeiro-acesso/%5Btoken%5D/page.tsx) | [Ativação da integração](flows/onboarding-activation.md) | Primeiro acesso via token. |
| [`/tv/[kioskId]`](../../src/app/tv/%5BkioskId%5D/page.tsx) | [Sinalização](flows/signage.md) | Redireciona ao player com quiosque. |
| [`/vagas`](../../src/app/vagas/page.tsx) | [Recrutamento](flows/recruitment.md) | Listagem pública de vagas. |
| [`/vagas/[slug]`](../../src/app/vagas/%5Bslug%5D/page.tsx) | [Recrutamento](flows/recruitment.md) | Detalhe e candidatura. |
| [`/vagas/banco-de-talentos`](../../src/app/vagas/banco-de-talentos/page.tsx) | [Recrutamento](flows/recruitment.md) | Formulário público de talentos. |
| [`/vagas/onboarding/[token]`](../../src/app/vagas/onboarding/%5Btoken%5D/page.tsx) | [Formulário da integração](flows/onboarding-public-documents.md) | Cadastro público por token. |

Quando uma página externa for criada, movida ou removida, regenere o [inventário](surface-inventory.md) e atualize esta tabela no mesmo trabalho. O CI detecta mudança de caminho no inventário; a relação com o fluxo depende de revisão humana.
