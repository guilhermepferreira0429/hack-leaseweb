// ElastiCache Redis (contentor redis-origem) -> Valkey (Leaseweb), chave a chave, sem apagar nada na origem:
// SCAN (nunca KEYS) + DUMP/RESTORE com o TTL que falta (PTTL). Se o Valkey não aceitar o formato do DUMP
// (versões diferentes), copia pelo tipo (string, hash, list, set, zset) e repõe o TTL.
// Prova: número de chaves dos dois lados e sha256 de (chave, tipo, valor, tem TTL). O TTL conta só como
// "tem ou não tem", porque desce com o tempo.
import { createHash } from 'node:crypto';
import { createClient, RESP_TYPES } from 'redis';
import { carregarEnv } from './ambiente';

export interface ResultadoCache {
  /** Chaves copiadas da origem nesta execução. */
  chaves: number;
  /** Chaves no Valkey com o mesmo padrão, depois da cópia. */
  noDestino: number;
  /** Quantas das copiadas têm TTL (na origem). */
  comTtl: number;
  /** Contagem por tipo (string, hash, list, set, zset, ...). */
  porTipo: Record<string, number>;
  /** Copiadas pelo tipo, porque o Valkey recusou o DUMP da origem (versões diferentes). */
  copiadasPorTipo: number;
  /** sha256 de (chave, tipo, valor, tem TTL) na origem e no destino. */
  shaOrigem: string;
  shaDestino: string;
}

type Cliente = ReturnType<typeof createClient>;
type Resposta = Buffer | string | number | null | Resposta[];

/** Respostas em Buffer: chaves e valores podem ser binários. */
const BUFFERS = { typeMapping: { [RESP_TYPES.BLOB_STRING]: Buffer } };
const LOTE = 200;

/** Fecha sem rebentar: um cliente que nunca chegou a ligar dá "The client is closed" no destroy. */
function fechar(c: Cliente | undefined): void {
  try {
    c?.destroy();
  } catch {
    // já estava fechado
  }
}

function cmd<T = Resposta>(c: Cliente, args: (string | Buffer)[]): Promise<T> {
  return c.sendCommand<T>(args, BUFFERS);
}

function lerCache(): { origemUrl: string; valkeyUrl: string } {
  carregarEnv();
  const v = (nome: string): string | undefined => {
    const valor = process.env[nome]?.trim();
    return valor && !valor.includes('<senha>') ? valor : undefined;
  };
  const origemUrl = v('REDIS_ORIGEM_URL');
  const valkeyUrl = v('VALKEY_URL');
  if (!origemUrl) throw new Error('REDIS_ORIGEM_URL is not set in .env');
  if (!valkeyUrl) throw new Error('VALKEY_URL is not set in .env');
  if (servidor(origemUrl) === servidor(valkeyUrl)) {
    throw new Error(`REDIS_ORIGEM_URL and VALKEY_URL point to the same server (${servidor(valkeyUrl)})`);
  }
  return { origemUrl, valkeyUrl };
}

/** host:porta/base de um URL redis://, sem utilizador nem senha (para mensagens de erro). */
function servidor(url: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.replace(/^\//, '') || '0';
    return `${u.hostname}:${u.port || '6379'}${base === '0' ? '' : `/${base}`}`;
  } catch {
    return '(URL inválido)';
  }
}

async function ligar(url: string, nome: string): Promise<Cliente> {
  const c: Cliente = createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  c.on('error', () => {});
  try {
    await c.connect();
    // Com requirepass e sem senha no URL, a ligação abre na mesma: só o PING diz se entrámos.
    await c.sendCommand(['PING']);
    return c;
  } catch (erro) {
    fechar(c);
    const texto = String(erro instanceof Error ? erro.message : erro);
    const porque = /WRONGPASS|NOAUTH|invalid password|AUTH/i.test(texto) ? 'rejected the credentials' : 'is not responding';
    throw new Error(`${nome} ${porque} at ${servidor(url)}`);
  }
}

/** Todas as chaves que casam com o padrão, por SCAN (nunca KEYS), sem repetidas e por ordem. */
async function listarChaves(c: Cliente, padrao: string): Promise<Buffer[]> {
  const vistas = new Map<string, Buffer>();
  let cursor = '0';
  do {
    const [proximo, chaves] = await cmd<[Buffer, Buffer[]]>(c, ['SCAN', cursor, 'MATCH', padrao, 'COUNT', '500']);
    cursor = proximo.toString();
    for (const k of chaves) vistas.set(k.toString('hex'), k);
  } while (cursor !== '0');
  return [...vistas.values()].sort(Buffer.compare);
}

/** Pares [a, b, c, d] -> [[a, b], [c, d]]. */
function pares(lista: Buffer[]): [Buffer, Buffer][] {
  const r: [Buffer, Buffer][] = [];
  for (let i = 0; i + 1 < lista.length; i += 2) r.push([lista[i], lista[i + 1]]);
  return r;
}

/** Copia uma chave pelo tipo, para quando o RESTORE recusa o DUMP. Só lê na origem. */
async function copiarPorTipo(origem: Cliente, destino: Cliente, chave: Buffer, tipo: string, ttl: number): Promise<void> {
  const escrever: (string | Buffer)[][] = [];
  if (tipo === 'string') {
    const v = await cmd<Buffer | null>(origem, ['GET', chave]);
    if (v === null) return;
    escrever.push(['SET', chave, v]);
  } else if (tipo === 'hash') {
    const campos = await cmd<Buffer[]>(origem, ['HGETALL', chave]);
    if (campos.length) escrever.push(['HSET', chave, ...campos]);
  } else if (tipo === 'list') {
    const itens = await cmd<Buffer[]>(origem, ['LRANGE', chave, '0', '-1']);
    if (itens.length) escrever.push(['RPUSH', chave, ...itens]);
  } else if (tipo === 'set') {
    const membros = await cmd<Buffer[]>(origem, ['SMEMBERS', chave]);
    if (membros.length) escrever.push(['SADD', chave, ...membros]);
  } else if (tipo === 'zset') {
    const lista = await cmd<Buffer[]>(origem, ['ZRANGE', chave, '0', '-1', 'WITHSCORES']);
    if (lista.length) escrever.push(['ZADD', chave, ...pares(lista).flatMap(([membro, nota]) => [nota, membro])]);
  } else {
    throw new Error(`Valkey rejected the DUMP and there is no type-by-type copy for keys of type ${tipo}`);
  }
  if (!escrever.length) return;
  await cmd(destino, ['DEL', chave]);
  for (const a of escrever) await cmd(destino, a);
  if (ttl > 0) await cmd(destino, ['PEXPIRE', chave, String(ttl)]);
}

/**
 * Copia uma chave. Devolve o tipo, ou null se a chave expirou entretanto.
 * Ex.: o DUMP do Redis 7.4 (RDB 12) é recusado pelo Valkey 8.1. Depois da 1.ª recusa
 * (`estado.dumpRecusado`), as chaves seguintes vão logo pela cópia por tipo.
 */
async function copiarChave(
  origem: Cliente,
  destino: Cliente,
  chave: Buffer,
  estado: { dumpRecusado: boolean },
): Promise<{ tipo: string; ttl: number; porTipo: boolean } | null> {
  const [tipoBuf, dump, pttl] = await Promise.all([
    cmd<Buffer | string>(origem, ['TYPE', chave]),
    estado.dumpRecusado ? Promise.resolve(undefined) : cmd<Buffer | null>(origem, ['DUMP', chave]),
    cmd<number>(origem, ['PTTL', chave]),
  ]);
  const tipo = tipoBuf.toString();
  if (dump === null || tipo === 'none' || pttl === -2) return null;
  const ttl = pttl > 0 ? pttl : 0;
  if (dump) {
    try {
      await cmd(destino, ['RESTORE', chave, String(ttl), dump, 'REPLACE']);
      return { tipo, ttl, porTipo: false };
    } catch (erro) {
      if (!/payload version|checksum|Bad data format/i.test(String(erro))) throw erro;
      estado.dumpRecusado = true;
    }
  }
  await copiarPorTipo(origem, destino, chave, tipo, ttl);
  return { tipo, ttl, porTipo: true };
}

/** Forma canónica de uma resposta (binário em base64), para entrar no sha256. */
function canonico(r: Resposta): string {
  if (Buffer.isBuffer(r)) return r.toString('base64');
  if (Array.isArray(r)) return `[${r.map(canonico).join(',')}]`;
  return String(r);
}

/** Uma linha "chave, tipo, valor, tem TTL". A ordem dos campos de hash e dos membros de set não conta. */
async function impressao(c: Cliente, chave: Buffer): Promise<string> {
  const [tipoBuf, pttl] = await Promise.all([cmd<Buffer | string>(c, ['TYPE', chave]), cmd<number>(c, ['PTTL', chave])]);
  const tipo = tipoBuf.toString();
  let valor: string;
  if (tipo === 'string') {
    valor = canonico(await cmd(c, ['GET', chave]));
  } else if (tipo === 'hash') {
    const p = pares(await cmd<Buffer[]>(c, ['HGETALL', chave])).sort((a, b) => Buffer.compare(a[0], b[0]));
    valor = canonico(p.flat());
  } else if (tipo === 'list') {
    valor = canonico(await cmd(c, ['LRANGE', chave, '0', '-1']));
  } else if (tipo === 'set') {
    valor = canonico((await cmd<Buffer[]>(c, ['SMEMBERS', chave])).sort(Buffer.compare));
  } else if (tipo === 'zset') {
    valor = canonico(await cmd(c, ['ZRANGE', chave, '0', '-1', 'WITHSCORES']));
  } else if (tipo === 'stream') {
    valor = canonico(await cmd(c, ['XRANGE', chave, '-', '+']));
  } else {
    valor = '?';
  }
  return [chave.toString('base64'), tipo, valor, pttl > 0 ? 'com-ttl' : 'sem-ttl'].join('\t');
}

async function shaDe(c: Cliente, chaves: Buffer[]): Promise<string> {
  const h = createHash('sha256');
  for (let i = 0; i < chaves.length; i += LOTE) {
    for (const linha of await Promise.all(chaves.slice(i, i + LOTE).map((k) => impressao(c, k)))) h.update(`${linha}\n`);
  }
  return h.digest('hex');
}

/**
 * Versão com o detalhe (para o CLI e o painel).
 * `opcoes.padrao`: só as chaves que casam com este padrão do SCAN (os testes usam um prefixo temporário);
 * por omissão, todas.
 */
export async function migrarCacheDetalhado(opcoes: { padrao?: string } = {}): Promise<ResultadoCache & { iguais: boolean }> {
  const cfg = lerCache();
  const padrao = opcoes.padrao ?? '*';
  let origem: Cliente | undefined;
  let destino: Cliente | undefined;
  try {
    origem = await ligar(cfg.origemUrl, 'Source Redis (ElastiCache)');
    destino = await ligar(cfg.valkeyUrl, 'Valkey');

    const chaves = await listarChaves(origem, padrao);
    const copiadas: Buffer[] = [];
    const porTipo: Record<string, number> = {};
    let comTtl = 0;
    let copiadasPorTipo = 0;
    const estado = { dumpRecusado: false };
    for (let i = 0; i < chaves.length; i += LOTE) {
      const lote = chaves.slice(i, i + LOTE);
      const r = await Promise.all(lote.map((k) => copiarChave(origem!, destino!, k, estado)));
      r.forEach((c, j) => {
        if (!c) return;
        copiadas.push(lote[j]);
        porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + 1;
        if (c.ttl > 0) comTtl++;
        if (c.porTipo) copiadasPorTipo++;
      });
    }

    // Prova: as mesmas chaves lidas dos dois lados, e o número de chaves do padrão no Valkey.
    const [shaOrigem, shaDestino, noDestino] = await Promise.all([
      shaDe(origem, copiadas),
      shaDe(destino, copiadas),
      listarChaves(destino, padrao).then((l) => l.length),
    ]);
    return {
      chaves: copiadas.length,
      noDestino,
      comTtl,
      porTipo,
      copiadasPorTipo,
      shaOrigem,
      shaDestino,
      iguais: noDestino === copiadas.length && shaOrigem === shaDestino,
    };
  } finally {
    fechar(origem);
    fechar(destino);
  }
}

/** Copia todas as chaves do Redis de origem para o Valkey e compara contagem e sha256 dos dois lados. */
export async function migrarCache(): Promise<{ chaves: number; iguais: boolean }> {
  const r = await migrarCacheDetalhado();
  return { chaves: r.chaves, iguais: r.iguais };
}
