const http = require('http');

const body = JSON.stringify({
  supplierId: "test",
  items: [{quantityOrdered: 1, unitPriceOrdered: 10}]
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/purchasing/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write(body);
req.end();
