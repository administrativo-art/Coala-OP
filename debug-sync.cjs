const { syncDay } = require('./src/lib/integrations/pdv-legal-service');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function testSync() {
  const kioskId = 'tirirical';
  const pdvFilialId = '17343';
  const dateStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  console.log(`Testing sync for ${dateStr}...`);
  try {
    const result = await syncDay(dateStr, kioskId, pdvFilialId);
    console.log('Sync Result:', result);
  } catch (error) {
    console.error('Sync Error:', error);
  }
}

testSync();
