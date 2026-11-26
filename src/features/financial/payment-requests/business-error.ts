/**
 * Regra de negócio da solicitação de pagamento, com mensagem escrita para o usuário. É um `Error` comum para os demais
 * chamadores; a rota de criação reconhece a marca e devolve a mensagem.
 */
export class PaymentRequestRuleError extends Error {}

export function paymentRequestError(message: string) {
  return new PaymentRequestRuleError(message);
}
