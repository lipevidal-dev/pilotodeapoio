@echo off
title Executando Testes Automatizados - Sistema de Escala PAO/APAO
echo ======================================================================
echo INICIANDO A SUITE DE TESTES DO SISTEMA DE ESCALA (V52 MODULAR)
echo ======================================================================
echo.

:: Ativa o ambiente virtual local se existir
if exist .venv\Scripts\activate.bat (
    echo [INFO] Ativando ambiente virtual (.venv)...
    call .venv\Scripts\activate.bat
) else (
    echo [AVISO] Ambiente virtual (.venv) nao encontrado! Executando com o python global...
)

echo.
echo [TESTE] Rodando pytest para verificar integridade e regras de negocio...
echo ----------------------------------------------------------------------
python -m pytest tests/ -v

echo ----------------------------------------------------------------------
if %ERRORLEVEL% EQU 0 (
    echo [OK] Todos os testes passaram com sucesso! O sistema esta estavel e seguro.
) else (
    echo [ERRO] Ocorreram falhas nos testes automatizados! Verifique os detalhes acima.
)
echo ======================================================================
echo.
pause
