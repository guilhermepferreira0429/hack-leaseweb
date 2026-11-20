// npm run dev:migrador [-- --so-analisar | --so-s3]
// Corre o migrador sozinho (sem pedir aprovação); na demo corre pelo orquestrador (npm run dev).
// Por omissão: S3 -> MinIO e, se DATABASE_URL_DESTINO estiver definida, Postgres -> Postgres na Leaseweb.
// E, se RABBITMQ_URL estiver definida, SQS -> RabbitMQ (move as mensagens de todas as filas);
// se OPENBAO_TOKEN estiver definido, Secrets Manager/SSM -> OpenBao; se VALKEY_URL, ElastiCache -> Valkey.
// Os segredos só aparecem por nome e sha256 abreviado, nunca o valor.
import { join } from 'node:path';
import { analisar } from './analisar';
import { carregarEnv, RAIZ_REPO } from './ambiente';
import { migrarS3Detalhado } from './migrar-dados';
import { migrarCacheDetalhado } from './migrar-cache';
import { migrarFilaDetalhado } from './migrar-fila';
import { migrarSegredosDetalhado } from './migrar-segredos';
import { migrarPostgresDetalhado } from './migrar-postgres';
import { verificarDetalhado } from './verificar';

const curto = (h: string): string => `${h.slice(0, 16)}…`;

async function main(): Promise<void> {
  carregarEnv();
  const dirApp = join(RAIZ_REPO, 'code', 'exemplo-app');
  let falhou = false;

  const { servicos, plano } = await analisar(dirApp);
  console.log(`[migrador] serviços encontrados: ${servicos.join(', ') || 'nenhum'}`);
  console.log(plano.replace(/^/gm, '  '));
  if (process.argv.includes('--so-analisar') || !servicos.includes('s3')) return;

  let t0 = Date.now();
  const m = await migrarS3Detalhado();
  const diferentes = m.objetos.filter((o) => o.origem !== o.destino);
  console.log(`[migrador] S3 -> MinIO, buckets ${m.buckets.join(', ')}: ${m.objetos.length} objetos em ${Date.now() - t0} ms`);
  for (const o of m.objetos.slice(0, 3)) console.log(`  ${o.bucket}/${o.chave}  ${curto(o.origem)} = ${curto(o.destino)}`);
  if (m.objetos.length > 3) console.log(`  … e mais ${m.objetos.length - 3}`);
  console.log(`[migrador] checksums ${m.checksumsOk ? 'todos iguais' : `DIFERENTES em ${diferentes.length}: ${diferentes.map((o) => o.chave).join(', ')}`}`);
  falhou ||= !m.checksumsOk;

  const comPostgres = servicos.includes('postgres') && !process.argv.includes('--so-s3') && Boolean(process.env.DATABASE_URL_DESTINO?.trim());
  if (comPostgres) {
    t0 = Date.now();
    const p = await migrarPostgresDetalhado();
    const linhas = p.tabelas.reduce((s, t) => s + t.linhasDestino, 0);
    console.log(`[migrador] Postgres -> Postgres na Leaseweb: ${p.tabelas.length} tabelas, ${linhas} linhas em ${Date.now() - t0} ms`);
    for (const t of p.tabelas) {
      const igual = t.linhasOrigem === t.linhasDestino && t.origem === t.destino;
      console.log(`  ${t.tabela}: ${t.linhasOrigem} -> ${t.linhasDestino} linhas, sha256 ${curto(t.origem)} ${igual ? '=' : '≠'} ${curto(t.destino)}`);
    }
    console.log(`[migrador] tabelas ${p.checksumsOk ? 'todas iguais' : 'DIFERENTES'}`);
    falhou ||= !p.checksumsOk;
  }

  const comFila = servicos.includes('fila') && !process.argv.includes('--so-s3') && Boolean(process.env.RABBITMQ_URL?.trim());
  if (comFila) {
    t0 = Date.now();
    const f = await migrarFilaDetalhado();
    const total = f.filas.reduce((s, x) => s + x.mensagens, 0);
    console.log(`[migrador] SQS -> RabbitMQ: ${f.filas.length} filas, ${total} mensagens em ${Date.now() - t0} ms`);
    for (const x of f.filas) console.log(`  ${x.fila}: ${x.mensagens} movidas, ${x.encontradas} com o mesmo sha256 no RabbitMQ`);
    console.log(`[migrador] mensagens ${f.iguais ? 'todas iguais' : 'DIFERENTES'}`);
    falhou ||= !f.iguais;
  }

  const definida = (nome: string): boolean => Boolean(process.env[nome]?.trim());
  if (servicos.includes('segredos') && !process.argv.includes('--so-s3') && definida('OPENBAO_TOKEN')) {
    t0 = Date.now();
    const s = await migrarSegredosDetalhado();
    console.log(`[migrador] Secrets Manager/SSM -> OpenBao: ${s.segredos.length} segredos em ${Date.now() - t0} ms (só nomes e sha256)`);
    for (const x of s.segredos) {
      console.log(`  ${x.origem} ${x.nome} (${x.tipo}) ${curto(x.shaOrigem)} ${x.shaOrigem === x.shaDestino ? '=' : '≠'} ${curto(x.shaDestino)}`);
    }
    console.log(`[migrador] segredos ${s.iguais ? 'todos iguais' : 'DIFERENTES'}`);
    falhou ||= !s.iguais;
  }

  if (servicos.includes('cache') && !process.argv.includes('--so-s3') && definida('VALKEY_URL')) {
    t0 = Date.now();
    const c = await migrarCacheDetalhado();
    console.log(`[migrador] ElastiCache Redis -> Valkey: ${c.chaves} chaves em ${Date.now() - t0} ms, ${c.iguais ? 'iguais' : 'DIFERENTES'}`);
    falhou ||= !c.iguais;
  }

  const v = await verificarDetalhado();
  console.log(
    `[migrador] testes da app: antes (AWS) ${v.antes.ok ? 'passam' : 'FALHAM'}; depois (Leaseweb: ${v.naLeaseweb.join(' + ')}) ${v.depois.ok ? 'passam' : 'FALHAM'}`,
  );
  for (const [lado, r] of [['antes', v.antes], ['depois', v.depois]] as const) {
    if (!r.ok) console.log(`  ${lado}:\n${r.resumo.replace(/^/gm, '    ')}`);
  }
  if (falhou || !v.antes.ok || !v.depois.ok) process.exitCode = 1;
}

main().catch((erro) => {
  console.error('[migrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
