import { AppError } from "@/lib/observability/app-error";

import { ParticipantActionUserError } from "./admission-signature-actions";

/**
 * Mensagens de negócio do fluxo de assinatura da admissão que podem chegar à tela (lista explícita, como exige o
 * `errorExposure: "sanitized"` do contrato da rota). Qualquer outra falha vira erro inesperado com referência.
 */
const SAFE_MESSAGES = new Set<string>([
  "A assinatura mudou durante o arquivamento; confira o pacote atual.",
  "A decisão não pode ser alterada após o envio do pacote para assinatura.",
  "A decisão sobre o salário-família só pode ser registrada após a conclusão da contabilidade.",
  "A origem do documento não corresponde à solicitação histórica.",
  "A preparação congelada do pacote está incompleta. Prepare o posicionamento novamente.",
  "A revisão só pode ser feita na etapa de preparação da assinatura.",
  "A solicitação mudou durante o retorno da assinatura.",
  "A versão do pacote não foi informada corretamente.",
  "Aprove ou finalize o documento antes de enviá-lo para assinatura.",
  "Componentes divergentes da solicitação histórica.",
  "Configure as assinaturas e rubricas antes de enviar o pacote.",
  "Confirme o posicionamento das assinaturas e rubricas antes do envio.",
  "Defina o signatário documental da empresa antes de incluí-lo no kit.",
  "Documento do fluxo de assinatura não encontrado.",
  "Documento gerado da solicitação não encontrado.",
  "Documento gerado não encontrado.",
  "Documento sem solicitação histórica confirmada.",
  "Este modelo não permite assinatura individual fora do fluxo de origem.",
  "Este pacote já está sendo enviado. Aguarde a conclusão antes de tentar novamente.",
  "Gere o pacote completo antes da revisão.",
  "Informe os dados dos dependentes antes de conceder o salário-família.",
  "Informe os dados dos dependentes para gerar o termo de salário-família.",
  "Informe um e-mail válido para cada signatário antes do envio.",
  "Integração não encontrada.",
  "Não há dependentes informados neste processo.",
  "O Autentique não confirmou o signatário da empresa.",
  "O PDF congelado foi alterado depois do posicionamento. Prepare o pacote novamente.",
  "O PDF de origem diverge da versão registrada.",
  "O PDF do termo de encerramento não foi gerado.",
  "O PDF oficial ainda não foi gerado.",
  "O arquivo assinado recebido não é um PDF válido.",
  "O arquivo histórico diverge da solicitação assinada.",
  "O conteúdo do documento não corresponde ao hash assinado.",
  "O conteúdo do pacote não corresponde ao hash assinado.",
  "O documento ainda não possui solicitação de assinatura.",
  "O documento existente diverge da assinatura atual.",
  "O envio só pode ser feito após a preparação e revisão dos documentos.",
  "O kit admissional precisa formar um único pacote para assinatura.",
  "O kit ainda não foi enviado ao Autentique.",
  "O kit já foi concluído e não aceita outro signatário.",
  "O kit já foi enviado e não aceita um novo posicionamento.",
  "O pacote admissional não possui documentos disponíveis para geração.",
  "O pacote arquivado não corresponde à assinatura atual.",
  "O pacote completo só pode ser visualizado durante a preparação da assinatura.",
  "O pacote exige reconciliação antes de arquivar a assinatura.",
  "O pacote já foi enviado e não aceita alteração de posições.",
  "O pacote já foi enviado e não pode voltar para revisão.",
  "O pacote mudou desde que o editor foi aberto. Reabra o posicionamento antes de enviar.",
  "O posicionamento não corresponde ao PDF congelado para este envio.",
  "O posicionamento não pertence ao PDF congelado para este envio.",
  "O posicionamento só pode ser preparado antes do envio do kit.",
  "O signatário da empresa precisa ser diferente do titular do kit.",
  "O titular não possui um e-mail válido.",
  "Os componentes mudaram durante o arquivamento; confira as referências.",
  "Os componentes mudaram durante o retorno da assinatura.",
  "Os documentos do pacote mudaram. Prepare o posicionamento novamente.",
  "Os documentos só podem ser gerados na etapa de preparação da assinatura.",
  "Os dois signatários do pacote precisam estar definidos antes do envio.",
  "Os modelos só podem ser selecionados na etapa de preparação da assinatura.",
  "PDF assinado excede 30 MB.",
  "Prepare o pacote antes de salvar o posicionamento.",
  "Registre a decisão do operador sobre o salário-família antes de preparar o kit.",
  "Revise o pacote completo antes de configurar as assinaturas.",
  "Revise o pacote completo antes de enviar para assinatura.",
  "Selecione e gere ao menos um documento do pacote admissional.",
  "Solicitação de assinatura não encontrada.",
  "Um dos modelos selecionados não está publicado.",
]);
const SAFE_PREFIXES = ["Gere ", "O PDF oficial de "];

export function signatureWorkflowAppError(cause: unknown): AppError | null {
  if (cause instanceof AppError) return cause;
  if (cause instanceof ParticipantActionUserError) {
    return new AppError({ code: "ADMISSION_SIGNATURE_PARTICIPANT_INVALID", kind: "VALIDATION", safeMessage: cause.message });
  }
  const message = cause instanceof Error ? cause.message : "";
  if (SAFE_MESSAGES.has(message) || SAFE_PREFIXES.some((prefix) => message.startsWith(prefix) && message.length <= 300)) {
    return new AppError({ code: "ADMISSION_SIGNATURE_BUSINESS_RULE", kind: "VALIDATION", safeMessage: message });
  }
  return null;
}
