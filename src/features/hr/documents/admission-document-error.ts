/**
 * Regra de documento ou assinatura com mensagem escrita para o usuário. É um `Error` comum: webhooks, tarefas e
 * outras rotas se comportam como antes. Só quem reconhece a marca devolve a mensagem na resposta.
 */
export class AdmissionDocumentError extends Error {}

export function admissionDocumentError(message: string) {
  return new AdmissionDocumentError(message);
}
