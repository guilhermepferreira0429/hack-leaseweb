// migrarCache contra chaves temporárias (prefixo aleatório) no redis-origem e no Valkey. Não toca nas chaves
// da app nem da seed. Saltado se REDIS_ORIGEM_URL/VALKEY_URL não estiverem no .env ou os contentores em baixo.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { createClient } from 'redis';
import { carregarEnv } from '../ambiente';
import { migrarCacheDetalhado } from '../migrar-cache';

carregarEnv();
const url = (nome: string): string => {
  const v = process.env[nome]?.trim() ?? '';
  return v.includes('<senha>') ? '' : v;
};
const ORIGEM_URL = url('REDIS_ORIGEM_URL');
const VALKEY_URL = url('VALKEY_URL');
const PREFIXO = `migrador-teste-${randomBytes(4).toString('hex')}`;
const PADRAO = `${PREFIXO}:*`;
const UMA_HORA = 3_600_000;
const STRINGS = 250; // mais do que um lote do SCAN e do que um lote de cópia

type Cliente = ReturnType<typeof createClient>;

async function ligar(u: string): Promise<Cliente> {
  const c: Cliente = createClient({ url: u, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  c.on('error', () => {});
  await c.connect();
  await c.ping();
  return c;
}

async function sondar(): Promise<string | false> {
  if (!ORIGEM_URL || !VALKEY_URL) return 'REDIS_ORIGEM_URL ou VALKEY_URL não definidas';
  try {
    for (const u of [ORIGEM_URL, VALKEY_URL]) (await ligar(u)).destroy();
    return false;
  } catch (erro) {
    return `redis-origem ou Valkey em baixo (npm run infra:up): ${erro instanceof Error ? erro.message : erro}`;
  }
}

const salto = await sondar();

async function apagarPrefixo(c: Cliente): Promise<void> {
  for await (const lote of c.scanIterator({ MATCH: PADRAO, COUNT: 500 })) if (lote.length) await c.del(lote);
}

describe('migrador: migrarCache', { skip: salto }, () => {
  let origem: Cliente;
  let valkey: Cliente;
  const k = (nome: string): string => `${PREFIXO}:${nome}`;

  before(async () => {
    origem = await ligar(ORIGEM_URL);
    valkey = await ligar(VALKEY_URL);
    for (let i = 0; i < STRINGS; i++) await origem.set(k(`sessao:${i}`), JSON.stringify({ cliente: `C-${i}`, carrinho: i }));
    await origem.set(k('com-ttl'), 'expira daqui a uma hora', { PX: UMA_HORA });
    await origem.set(k('binario'), Buffer.from([0, 255, 1, 254, 10, 13]));
    await origem.set(k('Café Central — Ç'), 'unicode na chave');
    await origem.hSet(k('hash'), { nome: 'Café Central', morada: 'Rua Direita, 1', 'código-postal': '1000-001' });
    await origem.pExpire(k('hash'), UMA_HORA);
    await origem.rPush(k('lista'), ['c', 'a', 'b', 'a']);
    await origem.sAdd(k('conjunto'), ['x', 'y', 'z']);
    await origem.zAdd(k('ranking'), [
      { score: 3, value: 'tres' },
      { score: 1.5, value: 'um-e-meio' },
      { score: -2, value: 'menos-dois' },
    ]);
  });

  after(async () => {
    for (const c of [origem, valkey]) {
      if (!c) continue;
      await apagarPrefixo(c).catch(() => {});
      c.destroy();
    }
  });

  const TOTAL = STRINGS + 7;

  it('copia todas as chaves, com tipos e TTL, e a prova dá igual', async () => {
    const r = await migrarCacheDetalhado({ padrao: PADRAO });
    assert.equal(r.chaves, TOTAL);
    assert.equal(r.noDestino, TOTAL);
    assert.equal(r.comTtl, 2);
    assert.deepEqual(r.porTipo, { string: STRINGS + 3, hash: 1, list: 1, set: 1, zset: 1 });
    assert.equal(r.shaOrigem, r.shaDestino);
    assert.equal(r.iguais, true);
  });

  it('o TTL que falta passa para o Valkey; quem não tinha TTL continua sem', async () => {
    const ttl = await valkey.pTTL(k('com-ttl'));
    assert.ok(ttl > UMA_HORA - 120_000 && ttl <= UMA_HORA, `PTTL no Valkey: ${ttl}`);
    assert.ok((await valkey.pTTL(k('hash'))) > 0);
    assert.equal(await valkey.pTTL(k('sessao:0')), -1);
    assert.deepEqual(await valkey.lRange(k('lista'), 0, -1), ['c', 'a', 'b', 'a']);
  });

  it('não apaga nada na origem', async () => {
    let n = 0;
    for await (const lote of origem.scanIterator({ MATCH: PADRAO, COUNT: 500 })) n += lote.length;
    assert.equal(n, TOTAL);
  });

  it('repetir não duplica e continua igual', async () => {
    const r = await migrarCacheDetalhado({ padrao: PADRAO });
    assert.equal(r.chaves, TOTAL);
    assert.equal(r.iguais, true);
  });

  it('uma chave a mais no Valkey faz a prova falhar', async () => {
    await valkey.set(k('so-no-destino'), 'intrusa');
    try {
      const r = await migrarCacheDetalhado({ padrao: PADRAO });
      assert.equal(r.noDestino, TOTAL + 1);
      assert.equal(r.iguais, false);
    } finally {
      await valkey.del(k('so-no-destino'));
    }
  });
});

describe('migrador: migrarCache (erros claros)', () => {
  async function comEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
    const antes = Object.fromEntries(Object.keys(vars).map((n) => [n, process.env[n]]));
    Object.assign(process.env, vars);
    try {
      await fn();
    } finally {
      for (const [n, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
    }
  }

  it('sem REDIS_ORIGEM_URL', () =>
    comEnv({ REDIS_ORIGEM_URL: '', VALKEY_URL: 'redis://127.0.0.1:6381' }, () =>
      assert.rejects(migrarCacheDetalhado(), { message: 'REDIS_ORIGEM_URL não está definida no .env' }),
    ));

  it('VALKEY_URL com o marcador <senha> conta como não definida', () =>
    comEnv({ REDIS_ORIGEM_URL: 'redis://127.0.0.1:6380', VALKEY_URL: 'redis://:<senha>@127.0.0.1:6381' }, () =>
      assert.rejects(migrarCacheDetalhado(), { message: 'VALKEY_URL não está definida no .env' }),
    ));

  it('origem e destino no mesmo servidor', () =>
    comEnv({ REDIS_ORIGEM_URL: 'redis://127.0.0.1:6381', VALKEY_URL: 'redis://:x@127.0.0.1:6381/0' }, () =>
      assert.rejects(migrarCacheDetalhado(), /apontam para o mesmo servidor \(127\.0\.0\.1:6381\)/),
    ));

  it('servidor em baixo: diz qual e onde, sem a senha', () =>
    comEnv({ REDIS_ORIGEM_URL: 'redis://:segredo@127.0.0.1:1', VALKEY_URL: 'redis://127.0.0.1:2' }, () =>
      assert.rejects(migrarCacheDetalhado(), (erro: Error) => {
        assert.equal(erro.message, 'Redis de origem (ElastiCache) não responde em 127.0.0.1:1');
        return true;
      }),
    ));
});
