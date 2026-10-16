import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { absenceCatalogDatabase, absenceCatalogStore } from '../catalog.server';
import { AppError } from '@/lib/observability/app-error';
import type { DPAbsenceType } from '@/types';
import { AbsencePreviewError, belemCivilDate, listAbsenceRequestOptions, previewAbsenceRequest } from './core';
import type { AbsenceRequestPreviewInput } from './schemas';
import { resolveAbsenceBeneficiary } from './beneficiary.server';
import { ownAbsenceResolutionTarget } from './target.server';
export { ownAbsenceResolutionTarget, absenceResolutionTargetForUser } from './target.server';

const COLLECTION = 'dp_absenceTypes';
const LIMIT = 100;

export async function listOwnAbsenceRequestOptions(actor: ServerUserContext, now = new Date(), beneficiaryUid?: string) {
  const resolved = beneficiaryUid && beneficiaryUid !== actor.decoded.uid
    ? await resolveAbsenceBeneficiary(actor, beneficiaryUid)
    : { target: await ownAbsenceResolutionTarget(actor), origin: 'collaborator' as const };
  if (!resolved.target) return [];
  const { target, origin } = resolved;
  const snapshot = await absenceCatalogStore().collection(COLLECTION).where('status', '==', 'published').limit(LIMIT + 1).get();
  if (snapshot.size > LIMIT) throw new AppError({ code: 'ABSENCE_OPTIONS_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Não foi possível carregar as opções de ausência agora.' });
  const types = snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPAbsenceType));
  return listAbsenceRequestOptions(types, target, belemCivilDate(now), origin);
}

export async function previewOwnAbsenceRequest(actor: ServerUserContext, input: AbsenceRequestPreviewInput, now = new Date(), beneficiaryUid?: string) {
  const { target, origin } = await resolveAbsenceBeneficiary(actor, beneficiaryUid);
  const document = await absenceCatalogStore().collection(COLLECTION).doc(input.absenceTypeId).get();
  if (!document.exists) throw new AppError({ code: 'ABSENCE_NOT_AVAILABLE', kind: 'NOT_FOUND', safeMessage: 'Tipo de ausência indisponível para esta pessoa e período.' });
  try {
    return previewAbsenceRequest(input, { id: document.id, ...document.data() } as DPAbsenceType, target, belemCivilDate(now), absenceCatalogDatabase(), origin);
  } catch (error) {
    if (!(error instanceof AbsencePreviewError)) throw error;
    if (error.reason === 'not_available' || error.reason === 'ambiguous') throw new AppError({ code: 'ABSENCE_NOT_AVAILABLE', kind: 'NOT_FOUND', safeMessage: 'Tipo de ausência indisponível para esta pessoa e período.' });
    const messages: Record<Exclude<AbsencePreviewError['reason'], 'not_available' | 'ambiguous'>, string> = {
      unit_disabled: 'Unidade de solicitação indisponível para este tipo.',
      notice: 'A antecedência mínima configurada não foi atendida.',
      retroactive: 'O prazo de retroatividade configurado foi excedido.',
      maximum: 'A quantidade excede o máximo configurado por solicitação.',
      invalid_period: 'O período informado não produz uma quantidade válida.',
    };
    throw new AppError({ code: 'ABSENCE_PREVIEW_INVALID', kind: 'VALIDATION', safeMessage: messages[error.reason] });
  }
}
