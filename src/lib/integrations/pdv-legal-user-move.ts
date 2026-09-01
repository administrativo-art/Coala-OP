export type PdvLegalUserMoveRecord = {
  id: string;
  active: boolean | null;
};

export class PdvLegalUserMoveCleanupError extends Error {
  constructor(
    message: string,
    public readonly compensationFailed: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PdvLegalUserMoveCleanupError";
  }
}

export function isPdvLegalUserRemovalConfirmed(user: PdvLegalUserMoveRecord | null) {
  return user === null || user.active === false;
}

/**
 * O endpoint de atualização do PDV Legal pode responder com sucesso sem aplicar
 * a nova filial. Nesse caso, substituímos o acesso de forma idempotente: criamos
 * (ou reutilizamos) o acesso no destino e só então removemos o acesso de origem.
 * Se a remoção falhar, uma inclusão feita neste fluxo é compensada para não
 * deixar dois acessos; um acesso preexistente no destino nunca é removido.
 */
export async function movePdvLegalUserWithCloneFallback<TUser extends PdvLegalUserMoveRecord>(params: {
  sourceUserId: string;
  update: () => Promise<TUser>;
  clone: () => Promise<{ user: TUser; created: boolean }>;
  remove: (userId: string) => Promise<void>;
  isUnconfirmedUpdate: (error: unknown) => boolean;
}): Promise<{ user: TUser; strategy: "update" | "replace" }> {
  try {
    return { user: await params.update(), strategy: "update" };
  } catch (error) {
    if (!params.isUnconfirmedUpdate(error)) throw error;
  }

  const replacement = await params.clone();
  if (replacement.user.id === params.sourceUserId) {
    throw new PdvLegalUserMoveCleanupError(
      "O PDV Legal não criou um acesso distinto na filial de destino.",
      false,
    );
  }

  try {
    await params.remove(params.sourceUserId);
  } catch (error) {
    let compensationFailed = false;
    if (replacement.created) {
      try {
        await params.remove(replacement.user.id);
      } catch {
        compensationFailed = true;
      }
    }
    throw new PdvLegalUserMoveCleanupError(
      "Não foi possível remover o acesso antigo do PDV Legal após criar o acesso na nova filial.",
      compensationFailed,
      { cause: error },
    );
  }

  return { user: replacement.user, strategy: "replace" };
}
