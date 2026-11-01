@echo off
REM ========================================
REM  REINICIADOR PERSONALIZADO DE AUDIO
REM  Reinicia: Realtek, Razer, USB Audio, Bluetooth
REM ========================================

echo ========================================
echo  REINICIANDO DRIVERS DE AUDIO DO PC
echo ========================================
echo.

REM Verificar privilégios de administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Execute como Administrador!
    echo.
    echo Clique com botao direito e selecione:
    echo "Executar como administrador"
    echo.
    pause
    exit /b 1
)

echo [1/4] Desabilitando Realtek Audio...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Realtek*Audio*' } | Disable-PnpDevice -Confirm:$false" >nul 2>&1

echo [2/4] Desabilitando Razer Audio (Barracuda X + BlackShark V2)...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Razer*' } | Disable-PnpDevice -Confirm:$false" >nul 2>&1

echo [3/4] Desabilitando USB Audio + Sound Blaster Z...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*USB*Audio*' -or $_.FriendlyName -like '*Sound Blaster*' } | Disable-PnpDevice -Confirm:$false" >nul 2>&1

echo [4/4] Desabilitando Bluetooth Audio...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Bluetooth*Audio*' } | Disable-PnpDevice -Confirm:$false" >nul 2>&1

echo.
echo Aguardando 3 segundos...
timeout /t 3 /nobreak >nul
echo.

echo [1/4] Reabilitando Realtek Audio...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Realtek*Audio*' } | Enable-PnpDevice -Confirm:$false" >nul 2>&1

echo [2/4] Reabilitando Razer Audio (Barracuda X + BlackShark V2)...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Razer*' } | Enable-PnpDevice -Confirm:$false" >nul 2>&1

echo [3/4] Reabilitando USB Audio + Sound Blaster Z...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*USB*Audio*' -or $_.FriendlyName -like '*Sound Blaster*' } | Enable-PnpDevice -Confirm:$false" >nul 2>&1

echo [4/4] Reabilitando Bluetooth Audio...
powershell -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -like '*Bluetooth*Audio*' } | Enable-PnpDevice -Confirm:$false" >nul 2>&1

echo.
echo ========================================
echo   CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo Dispositivos reiniciados:
echo  - Realtek(R) Audio
echo  - Razer Barracuda X
echo  - Razer BlackShark V2
echo  - Realtek USB Audio
echo  - Sound Blaster Z
echo  - Bluetooth Audio Device
echo  - L80
echo.
echo Seus drivers de audio foram reiniciados!
echo.
pause
