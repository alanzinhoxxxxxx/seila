@echo off
REM ========================================
REM  REINICIADOR DE DRIVERS DE AUDIO
REM  Reinicia todos os dispositivos de áudio
REM ========================================

echo ========================================
echo    REINICIADOR DE DRIVERS DE AUDIO
echo ========================================
echo.

REM Verificar se está rodando como Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERRO: Este script precisa ser executado como Administrador!
    echo.
    echo Clique com botao direito no arquivo e selecione "Executar como administrador"
    echo.
    pause
    exit /b 1
)

echo Buscando dispositivos de audio...
echo.

REM Usar PowerShell para desabilitar e reabilitar dispositivos de áudio
powershell -Command "& { Get-PnpDevice | Where-Object { $_.Class -eq 'AudioEndpoint' -or $_.Class -eq 'MEDIA' } | ForEach-Object { Write-Host 'Desabilitando:' $_.FriendlyName -ForegroundColor Yellow; Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue } }"

echo.
echo Aguardando 3 segundos...
timeout /t 3 /nobreak >nul

echo.
powershell -Command "& { Get-PnpDevice | Where-Object { $_.Class -eq 'AudioEndpoint' -or $_.Class -eq 'MEDIA' } | ForEach-Object { Write-Host 'Reabilitando:' $_.FriendlyName -ForegroundColor Green; Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue } }"

echo.
echo ========================================
echo   CONCLUIDO!
echo ========================================
echo.
echo Todos os dispositivos de audio foram reiniciados.
echo.
pause
