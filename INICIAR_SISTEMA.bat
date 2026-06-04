@echo off
title Sistema de Escala PAO/APAO - V52
color 0A

echo ======================================================
echo   SISTEMA DE ESCALA PAO/APAO - V52
echo ======================================================
echo.

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo ERRO: Python nao encontrado neste computador.
    echo Instale o Python 3.13.x 64 bits marcando "Add Python to PATH".
    echo.
    pause
    exit /b
)

echo Versao do Python encontrada:
python --version
echo.

if not exist ".venv" (
    echo Preparando o sistema pela primeira vez...
    python -m venv .venv
)

call ".venv\Scripts\activate.bat"

echo.
echo Atualizando instalador...
python -m pip install --upgrade pip setuptools wheel

echo.
echo Instalando dependencias com pacotes pre-compilados...
if not exist "requirements.txt" (
 echo requirements.txt nao encontrado.
 dir
 pause
 exit /b
)
python -m pip install --only-binary=:all: -r requirements.txt

if errorlevel 1 (
    echo.
    echo ======================================================
    echo   FALHA AO INSTALAR DEPENDENCIAS
    echo ======================================================
    echo.
    echo O computador tentou instalar uma biblioteca sem pacote compativel.
    echo.
    echo Solucao:
    echo 1. Instale Python 3.13.x 64 bits
    echo 2. Marque Add Python to PATH
    echo 3. Apague a pasta .venv dentro deste sistema
    echo 4. Clique novamente em INICIAR_SISTEMA.bat
    echo.
    pause
    exit /b
)

echo.
echo Abrindo o sistema no navegador...
echo Seus dados ficam salvos em: %USERPROFILE%\Sistema_Escala_PAO_APAO_Dados
echo Para encerrar, feche esta janela.
echo.

python -m streamlit run app.py

pause
