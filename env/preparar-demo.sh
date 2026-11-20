#!/usr/bin/env bash
# Preparação do cérebro antes de cada ensaio e da demo (docs/demo.md, "Preparação do cérebro").
# Corre da raiz do repo: bash env/preparar-demo.sh
# Ordem: verificar .env -> infra:up -> esvaziar o DESTINO -> seed na ORIGEM -> conferir a origem.
#   seed:limpar-destino só mexe no destino (MinIO, Valkey, RabbitMQ, OpenBao, Postgres de destino) e recusa se
#   algum destino apontar para a origem; o seed só mexe na origem (LocalStack, redis-origem, Postgres de origem)
#   e volta a pôr as 50 mensagens no SQS sem duplicar (esvazia a fila antes). No fim: origem cheia, destino vazio.
# Uma corrida de cada vez: não correr isto com um ensaio a meio.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Falta o .env na raiz (cp env/.env.example .env)"; exit 1; }
set -a; . ./.env; set +a

faltam=()
for v in POSTGRES_PASSWORD DATABASE_URL MINIO_ACCESS_KEY MINIO_SECRET_KEY POSTGRES_DESTINO_PASSWORD DATABASE_URL_DESTINO \
         RABBITMQ_USER RABBITMQ_PASSWORD RABBITMQ_URL REDIS_ORIGEM_PASSWORD REDIS_ORIGEM_URL VALKEY_PASSWORD VALKEY_URL OPENBAO_TOKEN; do
  [ -n "${!v:-}" ] || faltam+=("$v")
done
if [ ${#faltam[@]} -gt 0 ]; then echo "Faltam no .env: ${faltam[*]}"; exit 1; fi

echo "== 1/4 infra (LocalStack, Postgres origem e destino, MinIO, RabbitMQ, redis-origem, Valkey, OpenBao)"
docker compose -f env/docker-compose.yml --env-file .env up -d
for i in $(seq 1 45); do
  curl -sf http://127.0.0.1:4566/_localstack/health >/dev/null \
    && curl -sf "${MINIO_ENDPOINT:-http://127.0.0.1:9000}/minio/health/live" >/dev/null \
    && curl -sf "${OPENBAO_ADDR:-http://127.0.0.1:8200}/v1/sys/health" >/dev/null \
    && break
  sleep 2
done

echo "== 2/4 esvaziar o DESTINO (só o que a demo enche), para não aparecer cheio antes de Aprovar"
npm run -s seed:limpar-destino -- --sim

echo "== 3/4 seed na ORIGEM (dados falsos de uma PME; repõe também as 20 encomendas da app)"
npm run -s seed

echo "== 4/4 conferir a origem com o esperado.json"
npm run -s seed:comparar

echo
echo "Pronto: origem cheia, destino vazio."
echo "Ensaio: npm run dev -- --consola --uma-vez   ·   Prova no fim: npm run seed:comparar -- --destino"
