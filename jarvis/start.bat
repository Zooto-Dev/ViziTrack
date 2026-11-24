@echo off
setlocal
REM ============================================================
REM  JARVIS one-click start for Windows.
REM  No brackets in echo lines on purpose: cmd breaks on them.
REM  Every failure stops with a pause so the error stays visible.
REM ============================================================
cd /d "%~dp0"
title JARVIS

where python >nul 2>nul
if errorlevel 1 goto :no_python

if exist "backend\.venv\Scripts\python.exe" goto :have_venv
echo [1/3] Python environment bana raha hoon...
python -m venv backend\.venv
if errorlevel 1 goto :fail
:have_venv
set "PY=%~dp0backend\.venv\Scripts\python.exe"

"%PY%" -c "import fastapi, uvicorn, psutil, httpx, pydantic" >nul 2>nul
if not errorlevel 1 goto :deps_ok
echo [1/3] Packages install ho rahe hain, 2-3 minute lagenge. Window me click mat karna...
"%PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto :fail
:deps_ok

if exist "frontend\dist\index.html" goto :ui_ok
where node >nul 2>nul
if errorlevel 1 goto :no_node
echo [2/3] UI build kar raha hoon...
pushd frontend
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail_pop
call npm run build
if errorlevel 1 goto :fail_pop
popd
:ui_ok

echo [3/3] Jarvis start ho raha hai: http://127.0.0.1:8765
echo Ye window band mat karna. Jarvis band karna ho tab ise band karo.
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open-ui.ps1"
cd backend
"%PY%" run.py
echo.
echo Jarvis band ho gaya. Upar koi error dikhe toh uska screenshot bhejo.
pause
exit /b 0

:no_python
echo [X] Python nahi mila. python.org se install karo aur Add python.exe to PATH tick karna.
pause
exit /b 1

:no_node
echo [X] UI files nahi mili aur Node.js bhi nahi mila. Naya ZIP download karo.
pause
exit /b 1

:fail_pop
popd
:fail
echo.
echo [X] Kuch gadbad hui. Upar ka error screenshot karke bhejo.
pause
exit /b 1
