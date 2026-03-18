@echo off
echo Stopping relay...
taskkill /F /IM bun.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting relay via Task Scheduler...
schtasks /Run /TN "ClaudeTelegramRelay"

echo Done. Relay restarting in background.
