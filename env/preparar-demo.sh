#!/usr/bin/env bash
# Preparação do cérebro antes de cada ensaio e da demo (docs/demo.md, "Preparação").
# Corre da raiz do repo: bash env/preparar-demo.sh
# Ordem: verificar .env -> infra:up -> seed -> semear 20 -> esvaziar o DESTINO (MinIO) -> pronto para o ensaio.
# Só mexe no destino (MinIO). A origem (LocalStack) e o Postgres de origem ficam com os dados semeados.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Falta o .env na raiz (cp env/.env.example .env)"; exit 1; }
set -a; . ./.env; set +a

faltam=()
for v in POSTGRES_PASSWORD DATABASE_URL MINIO_ACCESS_KEY MINIO_SECRET_KEY POSTGRES_DESTINO_PASSWORD DATABASE_URL_DESTINO; do
  [ -n "${!v:-}" ] || faltam+=("$v")
done
if [ ${#faltam[@]} -gt 0 ]; then echo "Faltam no .env: ${faltam[*]}"; exit 1; fi

echo "== 1/4 infra (LocalStack, Postgres origem e destino, MinIO)"
docker compose -f env/docker-compose.yml --env-file .env up -d
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:4566/_localstack/health >/dev/null && curl -sf "${MINIO_ENDPOINT:-http://127.0.0.1:9000}/minio/health/live" >/dev/null && break
  sleep 2
done

echo "== 2/4 seed (dados falsos de uma PME na origem)"
npm run -s seed

echo "== 3/4 semear 20 encomendas (o teste 4 da app precisa delas)"
npm run -s dev:exemplo -- --semear 20

echo "== 4/4 esvaziar o destino (MinIO), para não aparecer cheio antes de Aprovar"
node --input-type=module -e '
import { S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({ endpoint: process.env.MINIO_ENDPOINT || "http://127.0.0.1:9000", region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY, secretAccessKey: process.env.MINIO_SECRET_KEY } });
const { Buckets = [] } = await s3.send(new ListBucketsCommand({}));
for (const { Name } of Buckets) {
  let apagados = 0, token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: Name, ContinuationToken: token }));
    const chaves = (r.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (chaves.length) await s3.send(new DeleteObjectsCommand({ Bucket: Name, Delete: { Objects: chaves, Quiet: true } }));
    apagados += chaves.length; token = r.NextContinuationToken;
  } while (token);
  console.log(`   ${Name}: ${apagados} objetos apagados no destino`);
}
'

echo
echo "Pronto. Ensaio: npm run dev -- --consola --uma-vez"
