# 🔧 Solución al Error "EADDRINUSE: address already in use :::3000"

## 🐛 **¿Qué significa este error?**

```
Error: listen EADDRINUSE: address already in use :::3000
```

Este error ocurre cuando intentas iniciar el servidor backend pero **el puerto 3000 ya está siendo usado** por otro proceso. Esto sucede comúnmente cuando:

1. ❌ El servidor anterior no se cerró correctamente
2. ❌ Hay múltiples instancias de Node.js ejecutándose
3. ❌ Otro programa está usando el puerto 3000
4. ❌ Nodemon no terminó el proceso anterior al reiniciar

## ✅ **Soluciones Rápidas**

### **Opción 1: Usar el Script Automático (RECOMENDADO)**

Hemos creado un script que libera el puerto automáticamente:

```bash
# Desde la raíz del proyecto
.\kill-port-3000.bat
```

Este script:
- 🔍 Busca todos los procesos usando el puerto 3000
- 🔪 Los termina automáticamente
- ✅ Te confirma que el puerto está libre

### **Opción 2: Comandos Manuales**

Si prefieres hacerlo manualmente:

```powershell
# 1. Buscar el proceso que usa el puerto 3000
netstat -ano | findstr :3000

# 2. Identificar el PID (última columna)
# Ejemplo de salida:
# TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    6344
#                                                   ^^^^
#                                                   Este es el PID

# 3. Terminar el proceso (reemplaza 6344 con tu PID)
taskkill /PID 6344 /F
```

### **Opción 3: Cambiar el Puerto**

Si no quieres matar el proceso, puedes cambiar el puerto del servidor:

1. Edita `backend/.env`:
```env
PORT=3001
```

2. Actualiza `frontend/js/api.js`:
```javascript
const API_URL = 'http://localhost:3001';
```

## 🛡️ **Prevención: Mejores Prácticas**

### **1. Cerrar el Servidor Correctamente**
Siempre usa `Ctrl + C` en la terminal para detener el servidor, no cierres la terminal directamente.

### **2. Verificar Antes de Iniciar**
Antes de ejecutar `npm run dev`, verifica que el puerto esté libre:
```powershell
netstat -ano | findstr :3000
```
Si no hay salida, el puerto está libre ✅

### **3. Usar el Script de Inicio Seguro**
Crea un archivo `start-dev.bat` en la raíz del proyecto:

```batch
@echo off
echo Liberando puerto 3000...
call kill-port-3000.bat
echo.
echo Iniciando servidor...
cd backend
npm run dev
```

Luego simplemente ejecuta:
```bash
.\start-dev.bat
```

### **4. Configurar Nodemon Correctamente**
Asegúrate de que `backend/package.json` tenga la configuración correcta:

```json
{
  "scripts": {
    "dev": "nodemon index.js",
    "start": "node index.js"
  }
}
```

## 🔍 **Diagnóstico Avanzado**

### **Ver Todos los Procesos Node.js Activos**
```powershell
tasklist | findstr node.exe
```

### **Matar Todos los Procesos Node.js (¡CUIDADO!)**
```powershell
taskkill /IM node.exe /F
```
⚠️ **Advertencia**: Esto cerrará TODOS los procesos de Node.js en tu sistema.

### **Ver Qué Programa Está Usando el Puerto**
```powershell
# Obtener el PID
for /f "tokens=5" %a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do @echo %a

# Ver detalles del proceso
tasklist /FI "PID eq [PID_AQUI]"
```

## 📋 **Checklist de Solución**

Cuando encuentres este error, sigue estos pasos:

- [ ] 1. Ejecuta `.\kill-port-3000.bat`
- [ ] 2. Verifica que el puerto esté libre: `netstat -ano | findstr :3000`
- [ ] 3. Inicia el servidor: `cd backend && npm run dev`
- [ ] 4. Verifica que el servidor esté corriendo correctamente
- [ ] 5. Prueba el endpoint de salud: http://localhost:3000/health

## 🚀 **Inicio Rápido del Servidor**

```powershell
# Opción A: Usando el script automático
.\kill-port-3000.bat
cd backend
npm run dev

# Opción B: Todo en uno
.\kill-port-3000.bat && cd backend && npm run dev
```

## 💡 **Consejos Adicionales**

1. **Múltiples Terminales**: Si trabajas con múltiples terminales, asegúrate de cerrar todas las instancias del servidor antes de iniciar una nueva.

2. **IDE Integrado**: Si usas VS Code, cierra todas las terminales integradas antes de iniciar el servidor.

3. **Reinicio de Windows**: Si el problema persiste, un reinicio del sistema liberará todos los puertos.

4. **Firewall**: Asegúrate de que el firewall de Windows no esté bloqueando el puerto 3000.

## 📞 **¿Aún Tienes Problemas?**

Si después de seguir estos pasos el error persiste:

1. Reinicia tu computadora
2. Verifica que no haya otros servicios usando el puerto 3000
3. Considera usar un puerto diferente (3001, 3002, etc.)
4. Revisa los logs de nodemon para otros errores

---

**Última actualización**: 24/02/2026
**Versión del proyecto**: 1.0.0
