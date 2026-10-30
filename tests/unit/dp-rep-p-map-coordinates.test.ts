import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMapCoordinates } from '../../src/features/dp/rep-p/map-coordinates';

test('lê o pino do lugar no endereço completo do Google Maps, não o centro da tela', () => {
  const tirirical = 'https://www.google.com/maps/place/Coala+Shakes+Tirirical/@-2.5650258,-44.231618,17z/data=!3m1!4b1!4m6!3m5!1s0x7f691c9138e3151:0x54a3565f8a23c7e8!8m2!3d-2.5650312!4d-44.2290377!16s%2Fg%2F11zzv2_62f';
  assert.deepEqual(parseMapCoordinates(tirirical), { latitude: -2.5650312, longitude: -44.2290377 });
  assert.deepEqual(parseMapCoordinates('https://www.google.com/maps/@-2.5491906,-44.2688766,17z'), { latitude: -2.5491906, longitude: -44.2688766 });
  assert.deepEqual(parseMapCoordinates('https://maps.google.com/?q=-2.4907232,-44.2550539'), { latitude: -2.4907232, longitude: -44.2550539 });
});

test('aceita latitude e longitude coladas e recusa link curto ou valor fora do globo', () => {
  assert.deepEqual(parseMapCoordinates(' -2.5029865, -44.2917909 '), { latitude: -2.5029865, longitude: -44.2917909 });
  assert.equal(parseMapCoordinates('https://maps.app.goo.gl/CwVKqenCNcRJAGW99'), null);
  assert.equal(parseMapCoordinates('95, 10'), null);
  assert.equal(parseMapCoordinates('Matriz'), null);
});
