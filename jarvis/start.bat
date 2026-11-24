@echo off
setlocal
REM ============================================================
REM  J.A.R.V.I.S. one-click start (Windows)
REM  First run: creates a Python venv, installs packages, builds UI.
REM  Later runs: just starts the backend and opens the app window.
REM ============================================================
cd /d "%~dp0"

where python >nul 2>nul || (
  echo [X] Python nahi mila. https://www.python.org/downloads/ se install karo
  echo     aur install ke time "Add python.exe to PATH" tick karna mat bhoolna.
  pause & exit /b 1
)

if not exist backend\.venv (
  echo [1/3] Python environment bana raha hoon...
  python -m venv backend\.venv || (echo venv fail & pause & exit /b 1)
  call backend\.venv\Scripts\activate.bat
  python -m pip install --upgrade pip >nul
  pip install -r backend\requirements.txt || (echo pip install fail & pause & exit /b 1)
) else (
  call backend\.venv\Scripts\activate.bat
)

if not exist frontend\dist\index.html (
  where node >nul 2>nul || (
    echo [X] Node.js nahi mila. https://nodejs.org/ se LTS install karo, phir start.bat dobara chalao.
    pause & exit /b 1
  )
  echo [2/3] UI build kar raha hoon (sirf pehli baar)...
  pushd frontend
  call npm install --no-audit --no-fund || (popd & pause & exit /b 1)
  call npm run build || (popd & pause & exit /b 1)
  popd
)

echo [3/3] Jarvis start ho raha hai...  http://127.0.0.1:8765
cd backend
start "" /b python run.py
cd ..

REM Wait for the backend, then open as a chromeless app window if Chrome/Edge exists.
set URL=http://127.0.0.1:8765
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40 -and -not $ok;$i++){ try { Invoke-WebRequest -UseBasicParsing %URL%/api/health -TimeoutSec 1 | Out-Null; $ok=$true } catch { Start-Sleep -Milliseconds 300 } }"
set CHROME=
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined CHROME if exist %%P set CHROME=%%P
)
if defined CHROME (
  start "" "%CHROME%" --app=%URL% --window-size=1440,900
) else (
  start "" %URL%
)
echo.
echo Jarvis chal raha hai. Is window ko band karne se Jarvis band ho jayega.
echo Ctrl+C dabao band karne ke liye.
pause >nul
