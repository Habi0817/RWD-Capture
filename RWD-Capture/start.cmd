@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 請先安裝 Node.js 22 或更新的 LTS 版本。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd start
:failed
pause
