// Script para probar la API de ventas
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/ventas',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('Respuesta:', parsed.length, 'ventas');
      if (parsed.length > 0) {
        console.log('Primera venta:', JSON.stringify(parsed[0], null, 2));
      }
    } catch (err) {
      console.log('Respuesta:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Error:', err.message);
});

req.end();