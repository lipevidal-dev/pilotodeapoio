# Deploy simples: envia o código do PC para o VPS e rebuilda Docker.
#
# Uso (PowerShell, na raiz do projeto):
#   .\scripts\deploy.ps1              # deploy normal
#   .\scripts\deploy.ps1 -InitVps     # primeira vez no servidor (Docker + Nginx + HTTPS)
#
# Pré-requisito: copie .env.deploy.example -> .env.deploy e preencha VPS_HOST.

param(
  [switch]$InitVps,
  [string]$Domain = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$envFile = Join-Path $Root ".env.deploy"
if (-not (Test-Path $envFile)) {
  Write-Host "ERRO: crie .env.deploy a partir de .env.deploy.example" -ForegroundColor Red
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    Set-Variable -Name $Matches[1] -Value $Matches[2] -Scope Script
  }
}

foreach ($var in @("VPS_HOST", "VPS_USER", "DEPLOY_PATH")) {
  if (-not (Get-Variable -Name $var -ErrorAction SilentlyContinue) -or -not (Get-Variable -Name $var).Value) {
    Write-Host "ERRO: $var ausente em .env.deploy" -ForegroundColor Red
    exit 1
  }
}

$Remote = "${VPS_USER}@${VPS_HOST}"
$SshPort = if (Get-Variable -Name SSH_PORT -ErrorAction SilentlyContinue) { $SSH_PORT } else { "22" }
$SshOpts = @("-p", $SshPort, "-o", "StrictHostKeyChecking=accept-new")
$ScpOpts = @("-P", $SshPort, "-o", "StrictHostKeyChecking=accept-new")
$Archive = Join-Path $env:TEMP "pilotodeapoiov2-deploy.tgz"
$RemoteArchive = "/tmp/pilotodeapoiov2-deploy.tgz"
$FixSh = "find '$DEPLOY_PATH/scripts' -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null; sed -i 's/\r$//' /tmp/deploy-remote.sh 2>/dev/null; true"

Write-Host "==> Empacotando projeto..." -ForegroundColor Cyan
if (Test-Path $Archive) { Remove-Item $Archive -Force }

$exclude = @(
  "--exclude=./node_modules",
  "--exclude=./frontend-admin/node_modules",
  "--exclude=./backend/node_modules",
  "--exclude=./dist",
  "--exclude=./frontend-admin/dist",
  "--exclude=./backend/dist",
  "--exclude=./.angular",
  "--exclude=./.git",
  "--exclude=./coverage",
  "--exclude=./docker-data",
  "--exclude=./_archive",
  "--exclude=./.env",
  "--exclude=./.env.deploy",
  "--exclude=./backend/.env"
)

& tar -czf $Archive @exclude -C $Root .

Write-Host "==> Enviando para $Remote ..." -ForegroundColor Cyan
scp @ScpOpts $Archive "${Remote}:${RemoteArchive}"
scp @ScpOpts (Join-Path $Root "scripts/deploy-remote.sh") "${Remote}:/tmp/deploy-remote.sh"

if ($InitVps) {
  Write-Host "==> Configuração inicial do VPS (Docker, Nginx, HTTPS)..." -ForegroundColor Cyan
  if (-not $Domain -and (Get-Variable -Name APP_DOMAIN -ErrorAction SilentlyContinue)) {
    $Domain = $APP_DOMAIN
  }
  if (-not $Domain) {
    $Domain = Read-Host "Domínio (ex: pcoordenador.com.br)"
  }
  if (-not $Domain) { $Domain = "pcoordenador.com.br" }

  ssh @SshOpts $Remote "mkdir -p '$DEPLOY_PATH' && tar -xzf '$RemoteArchive' -C '$DEPLOY_PATH' && $FixSh"
  ssh @SshOpts $Remote "$FixSh && DEPLOY_PATH='$DEPLOY_PATH' APP_DOMAIN='$Domain' bash '$DEPLOY_PATH/scripts/vps-init.sh'"

  Write-Host "==> Primeiro deploy (build Docker)..." -ForegroundColor Cyan
  ssh @SshOpts $Remote "$FixSh && chmod +x /tmp/deploy-remote.sh && DEPLOY_PATH='$DEPLOY_PATH' sh /tmp/deploy-remote.sh '$RemoteArchive'"

  Write-Host ""
  Write-Host "Tudo pronto! Acesse: https://www.$Domain/login" -ForegroundColor Green
  exit 0
}

Write-Host "==> Rebuild no servidor..." -ForegroundColor Cyan
ssh @SshOpts $Remote "$FixSh && chmod +x /tmp/deploy-remote.sh && DEPLOY_PATH='$DEPLOY_PATH' sh /tmp/deploy-remote.sh '$RemoteArchive'"

Write-Host ""
Write-Host "Deploy concluído! Abra o site no navegador e teste o login." -ForegroundColor Green
