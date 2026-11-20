// migrarPostgres contra bases de dados temporárias nos dois Postgres do docker-compose (não toca nas da app).
// Saltado se os Postgres não estiverem no ar (npm run infra:up) ou se DATABASE_URL_DESTINO não estiver definida.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { carregarEnv } from '../ambiente';
import { migrarPostgresDetalhado } from '../migrar-postgres';

carregarEnv();
const ORIGEM = process.env.DATABASE_URL?.trim() ?? '';
const DESTINO = process.env.DATABASE_URL_DESTINO?.trim() ?? '';
const NOME_BD = `migrador_teste_${randomBytes(4).toString('hex')}`;

function comBase(url: string, base: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
}

async function correr(url: string, sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  c.on('error', () => {});
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function sondar(): Promise<string | false> {
  if (!ORIGEM || !DESTINO || ORIGEM.includes('<senha>') || DESTINO.includes('<senha>')) return 'DATABASE_URL_DESTINO não definida';
  try {
    await Promise.all([correr(ORIGEM, 'SELECT 1'), correr(DESTINO, 'SELECT 1')]);
    return false;
  } catch (erro) {
    return `Postgres em baixo (npm run infra:up): ${erro instanceof Error ? erro.message : erro}`;
  }
}

const salto = await sondar();

const ESQUEMA = `
CREATE TYPE estado AS ENUM ('nova', 'paga', 'enviada', 'it''s');
CREATE SCHEMA loja;
CREATE TABLE loja.clientes (
  id     serial PRIMARY KEY,
  nome   text NOT NULL UNIQUE,
  desde  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loja.pedidos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id  int NOT NULL REFERENCES loja.clientes(id),
  estado      estado NOT NULL DEFAULT 'nova',
  total       numeric(12, 4) NOT NULL CHECK (total >= 0),
  iva         numeric(12, 4) GENERATED ALWAYS AS (total * 0.23) STORED,
  etiquetas   text[],
  dados       jsonb,
  anexo       bytea,
  criado_em   timestamptz NOT NULL
);
CREATE INDEX pedidos_por_cliente ON loja.pedidos (cliente_id, criado_em DESC);
CREATE TABLE registo_sem_chave (linha text, valor double precision);
`;

describe('migrador: migrarPostgres', { skip: salto }, () => {
  const origemTeste = comBase(ORIGEM, NOME_BD);
  const destinoTeste = comBase(DESTINO, NOME_BD);

  before(async () => {
    await correr(ORIGEM, `CREATE DATABASE ${NOME_BD}`);
    await correr(DESTINO, `CREATE DATABASE ${NOME_BD}`);
    await correr(origemTeste, ESQUEMA);
    await correr(origemTeste, `INSERT INTO loja.clientes (nome) SELECT 'cliente ' || g FROM generate_series(1, 30) g`);
    // 1200 pedidos: mais do que um lote, com microssegundos, nulos, aspas, unicode e bytes.
    await correr(
      origemTeste,
      `INSERT INTO loja.pedidos (cliente_id, estado, total, etiquetas, dados, anexo, criado_em)
       SELECT 1 + g % 30,
              (ARRAY['nova', 'paga', 'enviada', 'it''s']::estado[])[1 + g % 4],
              round((g * 13.3713)::numeric, 4),
              CASE WHEN g % 5 = 0 THEN NULL ELSE ARRAY['a"b', 'ç ã', 'x,y'] END,
              jsonb_build_object('g', g, 'texto', 'olá "mundo"'),
              CASE WHEN g % 3 = 0 THEN NULL ELSE decode(md5(g::text), 'hex') END,
              timestamptz '2026-11-20 09:00:00.123456+00' + g * interval '1 second 7 microseconds'
         FROM generate_series(1, 1200) g`,
    );
    await correr(origemTeste, `INSERT INTO registo_sem_chave VALUES ('b', 0.1), ('a', 1e-300), (NULL, 'NaN'), ('a', 0.1)`);
  });

  after(async () => {
    await correr(ORIGEM, `DROP DATABASE IF EXISTS ${NOME_BD} WITH (FORCE)`).catch(() => {});
    await correr(DESTINO, `DROP DATABASE IF EXISTS ${NOME_BD} WITH (FORCE)`).catch(() => {});
  });

  it('copia esquemas, tipos e linhas com contagem e sha256 iguais por tabela', async () => {
    process.env.DATABASE_URL = origemTeste;
    process.env.DATABASE_URL_DESTINO = destinoTeste;
    const r = await migrarPostgresDetalhado();
    assert.deepEqual(
      r.tabelas.map((t) => [t.tabela, t.linhasOrigem, t.linhasDestino]),
      [['loja.clientes', 30, 30], ['loja.pedidos', 1200, 1200], ['registo_sem_chave', 4, 4]],
    );
    for (const t of r.tabelas) assert.equal(t.destino, t.origem, `sha256 de ${t.tabela}`);
    assert.equal(r.checksumsOk, true);
  });

  it('o destino continua a funcionar: sequências, identidade, restrições e índices', async () => {
    const novo = await correr(destinoTeste, `INSERT INTO loja.clientes (nome) VALUES ('novo') RETURNING id`);
    assert.equal(novo.rows[0].id, 31, 'serial continua depois do maior id copiado');
    const pedido = await correr(
      destinoTeste,
      `INSERT INTO loja.pedidos (cliente_id, total, criado_em) VALUES (31, 10, now()) RETURNING id, iva, estado`,
    );
    assert.equal(pedido.rows[0].id, '1201', 'identidade continua');
    assert.equal(pedido.rows[0].iva, '2.3000', 'coluna gerada recalculada');
    assert.equal(pedido.rows[0].estado, 'nova', 'enum e default');
    await assert.rejects(correr(destinoTeste, `INSERT INTO loja.pedidos (cliente_id, total, criado_em) VALUES (999, 1, now())`), /foreign key/);
    await assert.rejects(correr(destinoTeste, `INSERT INTO loja.pedidos (cliente_id, total, criado_em) VALUES (1, -1, now())`), /check constraint/);
    await assert.rejects(correr(destinoTeste, `INSERT INTO loja.clientes (nome) VALUES ('cliente 1')`), /unique/);
    const idx = await correr(destinoTeste, `SELECT 1 FROM pg_indexes WHERE schemaname = 'loja' AND indexname = 'pedidos_por_cliente'`);
    assert.equal(idx.rowCount, 1);
  });

  it('repetir a migração dá o mesmo resultado (o destino recria-se)', async () => {
    const r = await migrarPostgresDetalhado();
    assert.equal(r.checksumsOk, true);
    assert.equal(r.tabelas.find((t) => t.tabela === 'loja.clientes')?.linhasDestino, 30);
  });
});
