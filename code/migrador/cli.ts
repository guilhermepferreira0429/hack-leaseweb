// npm run dev:migrador [-- --so-analisar]
// Corre o migrador sozinho (sem pedir aprovação); na demo corre pelo orquestrador (npm run dev).
import { join } from 'node:path';
import { analisar } from './analisar';
import { carregarEnv, RAIZ_REPO } from './ambiente';
import { migrarS3Detalhado } from './migrar-dados';
import { verificarDetalhado } from './verificar';

async function main(): Promise<void> {
  carregarEnv();
  const dirApp = join(RAIZ_REPO, 'code', 'exemplo-app');

  const { servicos, plano } = await analisar(dirApp);
  console.log(`[migrador] serviços encontrados: ${servicos.join(', ') || 'nenhum'}`);
  console.log(plano.replace(/^/gm, '  '));
  if (process.argv.includes('--so-analisar') || !servicos.includes('s3')) return;

  const t0 = Date.now();
  const m = await migrarS3Detalhado();
  const diferentes = m.objetos.filter((o) => o.origem !== o.destino);
  console.log(`[migrador] S3 -> MinIO, bucket ${m.bucket}: ${m.objetos.length} objetos em ${Date.now() - t0} ms`);
  for (const o of m.objetos.slice(0, 3)) console.log(`  ${o.chave}  ${o.origem.slice(0, 16)}… = ${o.destino.slice(0, 16)}…`);
  if (m.objetos.length > 3) console.log(`  … e mais ${m.objetos.length - 3}`);
  console.log(`[migrador] checksums ${m.checksumsOk ? 'todos iguais' : `DIFERENTES em ${diferentes.length}: ${diferentes.map((o) => o.chave).join(', ')}`}`);

  const v = await verificarDetalhado();
  console.log(`[migrador] testes da app: antes (LocalStack) ${v.antes.ok ? 'passam' : 'FALHAM'}; depois (MinIO) ${v.depois.ok ? 'passam' : 'FALHAM'}`);
  for (const [lado, r] of [['antes', v.antes], ['depois', v.depois]] as const) {
    if (!r.ok) console.log(`  ${lado}:\n${r.resumo.replace(/^/gm, '    ')}`);
  }
  if (!m.checksumsOk || !v.antes.ok || !v.depois.ok) process.exitCode = 1;
}

main().catch((erro) => {
  console.error('[migrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
