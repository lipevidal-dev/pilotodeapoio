#!/bin/sh

set -e



echo "==> Aguardando PostgreSQL..."

DB_HOST="${DB_HOST:-db}"

DB_PORT="${DB_PORT:-5432}"

DB_USER="${DB_USER:-piloto}"



until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q; do

  echo "    PostgreSQL indisponível — nova tentativa em 2s..."

  sleep 2

done

echo "==> PostgreSQL disponível."



echo "==> Aplicando migrations (prisma migrate deploy)..."

if ! npx prisma migrate deploy; then

  echo ""

  echo "========================================================================"

  echo " ERRO: prisma migrate deploy falhou."

  echo ""

  echo " Se aparecer P3009 (migration falhou anteriormente):"

  echo "   1) Reset DEV (apaga dados do banco):"

  echo "      docker compose down"

  echo "      docker volume rm pilotodeapoiov2_piloto_pg_data"

  echo "      docker compose up -d --build"

  echo ""

  echo "   2) Manter dados (após corrigir migration no código):"

  echo "      docker compose run --rm --no-deps backend \\"

  echo "        npx prisma migrate resolve --rolled-back 20250604230000_violation_levels"

  echo "      docker compose up -d --build backend"

  echo ""

  echo " Ver: infra/docker/README.md — seção P3009"

  echo "========================================================================"

  echo ""

  exit 1

fi



echo "==> Executando seed (idempotente)..."

if npx prisma db seed; then

  echo "==> Seed concluído."

else

  echo "==> Seed falhou ou já aplicado — continuando."

fi



echo "==> Iniciando API (porta ${PORT:-3333})..."

exec npm start

