@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0launcher"
title NovaLab Launcher - Windows Installer bauen

echo =============================================
echo       NOVALAB LAUNCHER - WINDOWS BUILD
echo =============================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] Node.js 24 wird benoetigt. Download: https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [FEHLER] npm ist nicht verfuegbar. Installiere Node.js erneut.
  pause
  exit /b 1
)

echo [1/3] Abhaengigkeiten installieren ...
call npm install --no-audit --no-fund
if errorlevel 1 goto :error

echo [2/3] Code ueberpruefen ...
call npm run check
if errorlevel 1 goto :error

echo [3/3] Windows Installer bauen ...
call npm run build:win
if errorlevel 1 goto :error

echo.
echo [ERFOLG] Installer erstellt. Der Ausgabeordner wird geoeffnet.
start "" "%CD%\dist"
pause
exit /b 0

:error
echo.
echo [FEHLER] Build fehlgeschlagen. Lies die Fehlermeldung oben.
pause
exit /b 1
