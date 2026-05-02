const https = require('https');
const http = require('http');

async function getToken() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            usuario: 'admin',
            password: 'admin123'
        });

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    if (res.statusCode === 200 && parsed.token) {
                        console.log('✅ Login exitoso');
                        console.log('🔑 Token obtenido:', parsed.token.substring(0, 50) + '...');
                        console.log('👤 Usuario:', parsed.usuario);
                        console.log('🎭 Rol:', parsed.rol);
                        resolve(parsed.token);
                    } else {
                        console.error('❌ Error en login:', parsed.error || parsed.message || 'Error desconocido');
                        console.log('Respuesta completa:', responseData);
                        reject(new Error('Login fallido'));
                    }
                } catch (err) {
                    console.error('❌ Error parseando respuesta:', err.message);
                    console.log('Respuesta raw:', responseData);
                    reject(err);
                }
            });
        });

        req.on('error', (err) => {
            console.error('❌ Error en la solicitud:', err.message);
            reject(err);
        });

        req.write(data);
        req.end();
    });
}

async function testUltimoNumero(token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/facturas-compra/ultimo-numero',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    console.log('\n🔍 Probando ruta /ultimo-numero:');
                    console.log('   Status:', res.statusCode);
                    console.log('   Respuesta:', JSON.stringify(parsed, null, 2));
                    
                    if (res.statusCode === 200) {
                        console.log('✅ Ruta /ultimo-numero funciona correctamente');
                        resolve(true);
                    } else {
                        console.error('❌ Error en ruta /ultimo-numero');
                        resolve(false);
                    }
                } catch (err) {
                    console.error('❌ Error parseando respuesta:', err.message);
                    console.log('Respuesta raw:', responseData);
                    resolve(false);
                }
            });
        });

        req.on('error', (err) => {
            console.error('❌ Error en la solicitud:', err.message);
            reject(err);
        });

        req.end();
    });
}

async function main() {
    try {
        console.log('🔐 Obteniendo token de autenticación...');
        const token = await getToken();
        
        console.log('\n🧪 Probando funcionalidad completa...');
        await testUltimoNumero(token);
        
    } catch (err) {
        console.error('❌ Error en el proceso:', err.message);
    }
}

main();