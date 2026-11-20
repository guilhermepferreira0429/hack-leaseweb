// RDS PostgreSQL (origem) -> PostgreSQL na Leaseweb (destino), só com o pg (sem pg_dump, sem binários).
// Esquema e linhas copiam-se tabela a tabela numa única transação no destino. A origem só é lida.
// Prova por tabela: contagem de linhas e sha256 das linhas ordenadas pela chave primária, dos dois lados;
// o destino volta-se a ler depois do COMMIT, com outra ligação.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { lerPostgres, semCredenciais } from './ambiente';

export interface ChecksumTabela {
  tabela: string;
  linhasOrigem: number;
  linhasDestino: number;
  origem: string;
  destino: string;
}

interface Coluna {
  nome: string;
  tipo: string;
  naoNulo: boolean;
  /** Valor por omissão ou, numa coluna gerada, a expressão. */
  expressao: string | null;
  identidade: '' | 'a' | 'd';
  gerada: '' | 's';
}

interface Tabela {
  oid: number;
  esquema: string;
  nome: string;
  /** "esquema"."nome", pronto a usar em SQL. */
  qualificado: string;
  /** Nome para mostrar: "encomendas" no public, "loja.produtos" nos outros. */
  rotulo: string;
  colunas: Coluna[];
  chave: string[];
  restricoes: { nome: string; tipo: string; definicao: string }[];
  indices: string[];
}

/** Linhas por lote (cópia e checksum). */
const LOTE = 500;

const q = (nome: string): string => `"${nome.replace(/"/g, '""')}"`;
const literal = (texto: string): string => `'${texto.replace(/'/g, "''")}'`;

/** Esquemas com dados da app: todos menos os do sistema. */
const ESQUEMAS_DO_UTILIZADOR = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'";

interface TipoEnum {
  esquema: string;
  nome: string;
  valores: string[];
}

async function lerEnums(c: pg.Client): Promise<TipoEnum[]> {
  const { rows } = await c.query<TipoEnum>(
    `SELECT n.nspname AS esquema, t.typname AS nome, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE ${ESQUEMAS_DO_UTILIZADOR}
      GROUP BY n.nspname, t.typname ORDER BY 1, 2`,
  );
  return rows;
}

/** Sessão com formatos fixos: o texto de cada linha tem de sair igual nos dois lados. */
async function ligar(url: string, papel: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  c.on('error', () => {});
  try {
    await c.connect();
  } catch {
    throw new Error(`${papel === 'origem' ? 'Source' : 'Target'} Postgres is not responding at ${semCredenciais(url)}`);
  }
  await c.query(
    "SET TIME ZONE 'UTC'; SET DateStyle = 'ISO, YMD'; SET IntervalStyle = 'postgres'; SET extra_float_digits = 3; SET bytea_output = 'hex'",
  );
  return c;
}

async function lerTabelas(c: pg.Client): Promise<Tabela[]> {
  const { rows: tabelas } = await c.query<{ oid: number; esquema: string; nome: string }>(
    `SELECT c.oid::int AS oid, n.nspname AS esquema, c.relname AS nome
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${ESQUEMAS_DO_UTILIZADOR} AND c.relkind = 'r' AND NOT c.relispartition
      ORDER BY n.nspname, c.relname`,
  );
  const resultado: Tabela[] = [];
  for (const t of tabelas) {
    const { rows: colunas } = await c.query<Coluna>(
      `SELECT a.attname AS nome, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS "naoNulo",
              pg_get_expr(d.adbin, d.adrelid) AS expressao, a.attidentity AS identidade, a.attgenerated AS gerada
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [t.oid],
    );
    const { rows: chave } = await c.query<{ nome: string }>(
      `SELECT a.attname AS nome
         FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = $1 AND i.indisprimary
        ORDER BY array_position(i.indkey::int2[], a.attnum)`,
      [t.oid],
    );
    const { rows: restricoes } = await c.query<{ nome: string; tipo: string; definicao: string }>(
      `SELECT conname AS nome, contype AS tipo, pg_get_constraintdef(oid) AS definicao
         FROM pg_constraint WHERE conrelid = $1 AND contype IN ('p', 'u', 'c', 'f') ORDER BY conname`,
      [t.oid],
    );
    const { rows: indices } = await c.query<{ def: string }>(
      `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
        WHERE i.indrelid = $1 AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)`,
      [t.oid],
    );
    const qualificado = `${q(t.esquema)}.${q(t.nome)}`;
    const rotulo = t.esquema === 'public' ? t.nome : `${t.esquema}.${t.nome}`;
    resultado.push({ ...t, qualificado, rotulo, colunas, chave: chave.map((k) => k.nome), restricoes, indices: indices.map((i) => i.def) });
  }
  return resultado;
}

function ordem(t: Tabela): string {
  return t.chave.length > 0 ? t.chave.map(q).join(', ') : '1';
}

/** Sequências usadas em DEFAULT nextval('...'): criam-se antes da tabela. */
function sequencias(t: Tabela): { sequencia: string; coluna: string }[] {
  return t.colunas.flatMap((col) => {
    const m = col.expressao?.match(/nextval\('((?:[^']|'')+)'::regclass\)/);
    return m && !col.gerada ? [{ sequencia: m[1]!.replace(/''/g, "'"), coluna: col.nome }] : [];
  });
}

function criarTabela(t: Tabela): string {
  const colunas = t.colunas.map((col) => {
    let def = `${q(col.nome)} ${col.tipo}`;
    if (col.gerada === 's') def += ` GENERATED ALWAYS AS (${col.expressao}) STORED`;
    else if (col.identidade) def += ` GENERATED ${col.identidade === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
    else if (col.expressao) def += ` DEFAULT ${col.expressao}`;
    if (col.naoNulo && !col.identidade) def += ' NOT NULL';
    return def;
  });
  return `CREATE TABLE ${t.qualificado} (\n  ${colunas.join(',\n  ')}\n)`;
}

/** sha256 e contagem das linhas (texto de cada registo) por ordem da chave primária. */
async function checksum(c: pg.Client, t: Tabela): Promise<{ linhas: number; sha256: string }> {
  const hash = createHash('sha256');
  let linhas = 0;
  for (;;) {
    const { rows } = await c.query<{ l: string }>(
      `SELECT t::text AS l FROM ${t.qualificado} t ORDER BY ${ordem(t)} LIMIT ${LOTE} OFFSET ${linhas}`,
    );
    for (const r of rows) hash.update(r.l).update('\n');
    linhas += rows.length;
    if (rows.length < LOTE) break;
  }
  return { linhas, sha256: hash.digest('hex') };
}

/** Copia as linhas como texto (o Postgres converte de volta para o tipo da coluna: sem perder precisão). */
async function copiarLinhas(origem: pg.Client, destino: pg.Client, t: Tabela): Promise<void> {
  const cols = t.colunas.filter((c) => !c.gerada);
  if (cols.length === 0) return;
  const lote = Math.max(1, Math.min(LOTE, Math.floor(60000 / cols.length)));
  const lista = cols.map((c) => q(c.nome)).join(', ');
  const selecao = cols.map((c) => `${q(c.nome)}::text`).join(', ');
  for (let lidas = 0; ; ) {
    const { rows } = await origem.query({
      text: `SELECT ${selecao} FROM ${t.qualificado} ORDER BY ${ordem(t)} LIMIT ${lote} OFFSET ${lidas}`,
      rowMode: 'array',
    });
    if (rows.length > 0) {
      const valores = rows.map((_, i) => `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(', ')})`);
      await destino.query(
        `INSERT INTO ${t.qualificado} (${lista}) OVERRIDING SYSTEM VALUE VALUES ${valores.join(', ')}`,
        (rows as unknown[][]).flat(),
      );
    }
    lidas += rows.length;
    if (rows.length < lote) break;
  }
}

/** Versão com o detalhe por tabela (para o CLI e o painel). */
export async function migrarPostgresDetalhado(): Promise<{ tabelas: ChecksumTabela[]; checksumsOk: boolean }> {
  const urls = lerPostgres();
  const origem = await ligar(urls.origem, 'origem');
  let destino: pg.Client | undefined;
  const somaOrigem = new Map<string, { linhas: number; sha256: string }>();
  try {
    destino = await ligar(urls.destino, 'destino');
    // Fotografia consistente da origem durante toda a cópia; nunca se escreve nela.
    await origem.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tabelas = await lerTabelas(origem);
    if (tabelas.length === 0) throw new Error('The source database has no tables: nothing to migrate');

    const enums = await lerEnums(origem);
    for (const t of tabelas) somaOrigem.set(t.rotulo, await checksum(origem, t));

    // O destino é nosso: recria-se de cada vez, para a migração poder repetir-se com o mesmo resultado.
    await destino.query('BEGIN');
    try {
      const esquemas = [...new Set([...tabelas.map((t) => t.esquema), ...enums.map((e) => e.esquema)])];
      for (const e of esquemas) await destino.query(`CREATE SCHEMA IF NOT EXISTS ${q(e)}`);
      for (const t of tabelas) await destino.query(`DROP TABLE IF EXISTS ${t.qualificado} CASCADE`);
      for (const e of enums) {
        const nome = `${q(e.esquema)}.${q(e.nome)}`;
        await destino.query(`DROP TYPE IF EXISTS ${nome} CASCADE`);
        await destino.query(`CREATE TYPE ${nome} AS ENUM (${e.valores.map(literal).join(', ')})`);
      }
      for (const t of tabelas) {
        for (const s of sequencias(t)) await destino.query(`CREATE SEQUENCE IF NOT EXISTS ${s.sequencia}`);
        await destino.query(criarTabela(t));
        for (const s of sequencias(t)) await destino.query(`ALTER SEQUENCE ${s.sequencia} OWNED BY ${t.qualificado}.${q(s.coluna)}`);
      }
      for (const t of tabelas) await copiarLinhas(origem, destino, t);
      // Restrições depois dos dados (mais rápido e sem problemas de ordem); chaves estrangeiras no fim.
      const todas = tabelas.flatMap((t) => t.restricoes.map((r) => ({ t, r })));
      for (const { t, r } of [...todas.filter((x) => x.r.tipo !== 'f'), ...todas.filter((x) => x.r.tipo === 'f')]) {
        await destino.query(`ALTER TABLE ${t.qualificado} ADD CONSTRAINT ${q(r.nome)} ${r.definicao}`);
      }
      for (const t of tabelas) for (const i of t.indices) await destino.query(i);
      // Sequências e identidades continuam a seguir o maior valor copiado.
      for (const t of tabelas) {
        const alvo = [
          ...sequencias(t).map((s) => ({ seq: literal(s.sequencia), coluna: s.coluna })),
          ...t.colunas
            .filter((c) => c.identidade)
            .map((c) => ({ seq: `pg_get_serial_sequence(${literal(t.qualificado)}, ${literal(c.nome)})`, coluna: c.nome })),
        ];
        for (const a of alvo) {
          await destino.query(
            `SELECT setval(${a.seq}, COALESCE((SELECT max(${q(a.coluna)}) FROM ${t.qualificado}), 0) + 1, false)`,
          );
        }
      }
      await destino.query('COMMIT');
    } catch (erro) {
      await destino.query('ROLLBACK').catch(() => {});
      throw erro;
    }
    await origem.query('COMMIT');
  } finally {
    await origem.end().catch(() => {});
    await destino?.end().catch(() => {});
  }

  // Prova: o destino volta-se a ler depois do COMMIT, com uma ligação nova, e compara-se com a
  // fotografia da origem de onde se copiou (a mesma transação da cópia).
  const d = await ligar(urls.destino, 'destino');
  try {
    const tabelasDestino = new Map((await lerTabelas(d)).map((t) => [t.rotulo, t]));
    const resultado: ChecksumTabela[] = [];
    for (const [nome, so] of somaOrigem) {
      const td = tabelasDestino.get(nome);
      const sd = td ? await checksum(d, td) : { linhas: 0, sha256: '(table missing in target)' };
      resultado.push({ tabela: nome, linhasOrigem: so.linhas, linhasDestino: sd.linhas, origem: so.sha256, destino: sd.sha256 });
    }
    return {
      tabelas: resultado,
      checksumsOk: resultado.every((r) => r.linhasOrigem === r.linhasDestino && r.origem === r.destino),
    };
  } finally {
    await d.end().catch(() => {});
  }
}

/** Copia esquema e linhas para o Postgres na Leaseweb e prova, tabela a tabela, que ficaram iguais. */
export async function migrarPostgres(): Promise<{ tabelas: number; linhas: number; checksumsOk: boolean }> {
  const r = await migrarPostgresDetalhado();
  return {
    tabelas: r.tabelas.length,
    linhas: r.tabelas.reduce((soma, t) => soma + t.linhasDestino, 0),
    checksumsOk: r.checksumsOk,
  };
}
