@echo off
cd /d "%~dp0.."
call .venv\Scripts\python.exe -m pytest tests\test_rules.py -q
if errorlevel 1 (
  echo.
  echo FALHA: corrija antes de usar o mes em producao.
  exit /b 1
)
echo.
echo OK: regras basicas validadas.
exit /b 0
