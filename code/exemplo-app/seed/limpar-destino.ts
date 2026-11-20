// npm run seed:limpar-destino -- --sim
// Esvazia, no MinIO de DESTINO, só os buckets da seed (faturas e fotos-produtos), para a demo começar
// com o destino vazio. Nunca toca na origem (LocalStack), na base de dados, na fila nem noutros buckets.
// Sem --sim só mostra o que apagaria.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { carregarEnvLocal, clienteS3 } from '../adaptadores';
import { lerLado } from './comparar';

const CAMINHO_ESPERADO = fileURLToPath(new URL('./esperado.json', import.meta.url));

function hostPorta(url: string): string {
  const u = new URL(url);
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
  return `${host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
}

async function main(): Promise<void> {
  carregarEnvLocal();
  const apagar = process.argv.includes('--sim');
  const destino = lerLado(true);
  const origem = lerLado(false);
  // Salvaguarda: se o .env apontar o MinIO para o LocalStack, isto apagaria a origem.
  if (hostPorta(destino.s3.endpoint) === hostPorta(origem.s3.endpoint)) {
    throw new Error(`MINIO_ENDPOINT (${destino.s3.endpoint}) é o mesmo que a origem: recuso apagar`);
  }
  const buckets = Object.keys((JSON.parse(readFileSync(CAMINHO_ESPERADO, 'utf8')) as { buckets: Record<string, unknown> }).buckets);
  const s3 = clienteS3(destino.s3);
  try {
    for (const bucket of buckets) {
      let total = 0;
      try {
        if (apagar) {
          // Apaga em lotes de 1000 e volta a listar do início até o bucket ficar vazio.
          for (;;) {
            const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));
            const chaves = (r.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
            if (chaves.length === 0) break;
            const d = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chaves, Quiet: true } }));
            if (d.Errors?.length) throw new Error(`${bucket}: ${d.Errors.length} objetos não foram apagados (${d.Errors[0]?.Message ?? ''})`);
            total += chaves.length;
          }
        } else {
          let token: string | undefined;
          do {
            const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
            total += r.Contents?.length ?? 0;
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
          } while (token);
        }
      } catch (erro) {
        if ((erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          console.log(`  ${bucket}: não existe no destino (nada a fazer)`);
          continue;
        }
        throw erro;
      }
      console.log(`  ${bucket}: ${total} objetos ${apagar ? 'apagados' : 'seriam apagados'}`);
    }
  } finally {
    s3.destroy();
  }
  console.log(apagar ? `[seed:limpar-destino] ${destino.nome} vazio nos buckets da seed` : '[seed:limpar-destino] nada apagado; para apagar: npm run seed:limpar-destino -- --sim');
}

main().catch((erro) => {
  console.error('[seed:limpar-destino]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
