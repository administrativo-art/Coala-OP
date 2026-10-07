import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { runMinimumStockRecalculation } from './stock-min-recalc.js';
import { runMinimumStockRecalculation as runLegacyMinimumStockRecalculation } from './legacy-stock-min-recalc.js';

export const recalculateMinimumStock = onSchedule({
  schedule: '0 3 1,16 * *', timeZone: 'America/Belem', retryCount: 2,
  timeoutSeconds: 300, memory: '512MiB',
}, async () => {
  const enabled = process.env.REPLENISHMENT_POLICY_ENABLED === 'true';
  if (!enabled) {
    logger.info('Legacy minimum stock recalculation', await runLegacyMinimumStockRecalculation(getFirestore('coala'), new Date()));
  }
  logger.info('Minimum stock recalculation', {
    enabled,
    ...await runMinimumStockRecalculation(getFirestore('coala'), new Date(), undefined, enabled),
  });
});
