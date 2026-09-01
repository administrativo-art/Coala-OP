type TransportVoucherServiceStatusInput = {
  needsTransportVoucher: boolean | undefined;
  publicAnswer: unknown;
  recordedCompleted: boolean;
};

export function resolveTransportVoucherServiceStatus(
  input: TransportVoucherServiceStatusInput,
) {
  const decision = typeof input.needsTransportVoucher === 'boolean'
    ? input.needsTransportVoucher
    : input.publicAnswer === 'yes'
      ? true
      : input.publicAnswer === 'no'
        ? false
        : null;

  if (decision === false) {
    return {
      completed: true,
      notApplicable: true,
      description: 'Não solicitado pela colaboradora.',
    } as const;
  }

  return {
    completed: input.recordedCompleted,
    notApplicable: false,
    description: 'Cadastro confirmado no sistema de VT.',
  } as const;
}
