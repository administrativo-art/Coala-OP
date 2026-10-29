# Documentos e histórico de férias

Autorizado: implementação local em 29/10/2026. Commit e rollout autorizados pelo usuário em 29/10/2026. Migração de registros históricos fora do escopo.

- Preservar originais e decisões de descarte/correção, com autor, data e motivo.
- Consultar histórico interno sem voltar a selecionar versões descartadas/substituídas.
- Identificar aprovação da versão aceita.
- Manter aviso, recibo e comprovante separados no agrupamento aquisitivo/parcela/gozo.
- Importação histórica permanece documental, sem criar pagamentos ou assinaturas.
- Verificar transições, compatibilidade legada, agrupamento, tipos, lint e contratos.

Sem migração dos históricos antigos: motivos ausentes são apresentados como não registrados.

Resultado local: implementação concluída; 81 testes dirigidos e 1 cenário integrado de API em Auth/Firestore emulados aprovados. Typecheck, lint sem erros e contratos aprovados. E2E de navegador incluído na conferência pré-publicação. Execução operacional financeira/assinatura real não realizada. Entrega seguirá por PR para main e promoção específica para production; resultado do rollout no registro local da tarefa.
