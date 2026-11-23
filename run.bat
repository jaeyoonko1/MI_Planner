@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
  echo [ERROR] .venv not found. Run: py -3 -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)
call ".venv\Scripts\activate.bat"

start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8765"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
pause
