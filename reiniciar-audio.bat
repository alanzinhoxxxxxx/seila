@echo off
echo ========================================
echo    REINICIADOR DE DRIVERS DE AUDIO
echo ========================================
echo.
echo Reiniciando drivers de audio...
echo.

REM Desabilitar todos os dispositivos de áudio
echo [1/2] Desabilitando drivers de audio...
pnputil /disable-device "HDAUDIO\*" >nul 2>&1
pnputil /disable-device "USB\VID_*&PID_*&MI_00" >nul 2>&1

REM Aguardar 2 segundos
timeout /t 2 /nobreak >nul

REM Reabilitar todos os dispositivos de áudio
echo [2/2] Reabilitando drivers de audio...
pnputil /enable-device "HDAUDIO\*" >nul 2>&1
pnputil /enable-device "USB\VID_*&PID_*&MI_00" >nul 2>&1

REM Aguardar 2 segundos
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   DRIVERS DE AUDIO REINICIADOS!
echo ========================================
echo.
echo Pressione qualquer tecla para fechar...
pause >nul
