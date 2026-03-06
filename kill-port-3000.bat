@echo off
echo Buscando procesos en puerto 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Terminando proceso con PID %%a
    taskkill /PID %%a /F
)
echo.
echo Puerto 3000 liberado. Puedes iniciar el servidor ahora.
pause
