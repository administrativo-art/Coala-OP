const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/purchasing/quotations/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': 2
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write('{}');
req.end();
