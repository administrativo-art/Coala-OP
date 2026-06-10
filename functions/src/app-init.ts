import { initializeApp } from 'firebase-admin/app';

/**
 * Inicializa o Firebase Admin uma única vez, como efeito colateral de import.
 *
 * DEVE ser o PRIMEIRO import do index.ts. Módulos re-exportados pelo index
 * (ex.: rh/sync) chamam getFirestore() no topo do módulo; como imports/re-exports
 * ESM são avaliados antes do corpo do index, sem isto o getFirestore rodaria
 * antes do initializeApp() e quebraria com "The default Firebase app does not exist".
 */
initializeApp();
