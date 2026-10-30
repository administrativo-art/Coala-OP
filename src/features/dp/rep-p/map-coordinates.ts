/**
 * Lê latitude e longitude coladas no cadastro da unidade: "-2.5650312, -44.2290377" ou o endereço completo de um
 * lugar no Google Maps. O pino do lugar (`!3d…!4d…`) vale mais que o centro da tela (`@lat,lng`).
 * O link curto (maps.app.goo.gl) não traz coordenadas e precisa ser aberto antes.
 */
export function parseMapCoordinates(text: string): { latitude: number; longitude: number } | null {
  const value = text.trim();
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* texto com % solto: usa como veio */ }
  const pin = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const view = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const query = decoded.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const plain = decoded.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  const match = pin ?? query ?? view ?? plain;
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
