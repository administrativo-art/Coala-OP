import { defineSecret, defineString } from 'firebase-functions/params';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';

const relaySecret = defineSecret('REP_P_AVAILABILITY_MONITOR_SECRET');
const relayUrl = defineString('REP_P_AVAILABILITY_RELAY_URL', {
  default: 'https://op.coalashakes.com/api/jobs/rep-p/availability-events',
});

export const REP_P_AVAILABILITY_TOPIC = 'rep-p-availability-alerts';

/**
 * Recebe a decisão do Cloud Monitoring por Pub/Sub e a entrega ao único escritor legítimo da ARP.
 * Falhas lançam erro para manter o evento na fila; a rota é idempotente pelo incident_id.
 */
export const repPAvailabilityAlertRelay = onMessagePublished({
  topic: REP_P_AVAILABILITY_TOPIC,
  region: 'southamerica-east1',
  retry: true,
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  secrets: [relaySecret],
}, async (event) => {
  const payload = event.data.message.json;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 64_000) throw new Error('Notificação do monitor REP-P excede o limite.');
  const response = await fetch(relayUrl.value(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${relaySecret.value()}`,
      'Content-Type': 'application/json',
    },
    body: serialized,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Monitor REP-P respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { status?: string; establishments?: number; events?: number };
  console.log('[repPAvailabilityAlertRelay] Entregue.', result);
});
