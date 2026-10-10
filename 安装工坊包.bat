@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "NODE="
if exist "%HERE%node\node.exe" set "NODE=%HERE%node\node.exe"
if not defined NODE set "NODE=node"
"%NODE%" "%HERE%app\tools\workshop-pack.mjs" import %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%
