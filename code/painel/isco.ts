// GET /isco: quantas tentativas de entrada a VM isco recebeu desde que foi ligada, e de quantos IPs.
// Lê /var/log/auth.log por SSH (ISCO_HOST, ISCO_SSH_USER, só chave), ou da própria máquina com ISCO_HOST=local
// (quando o painel corre no isco, como a VM da organização). Ver docs/demo.md.
// Só números medidos; nada inventado.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { carregarEnv } from '@mwbe/shared';

export interface ContagemIsco {
  tentativas: number;
  ipsDistintos: number;
  desde: string;
  lidoEm: string;
}

// Login com sucesso: é alguém da equipa (só entra quem tem a chave ou a password). O IP dele não conta.
const ACEITE = /sshd(?:-session)?\[\d+\]: Accepted \S+ for \S+ from (\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)/i;

// Uma tentativa = uma sessão sshd (pid) com pelo menos uma falha de autenticação de um IP externo.
const FALHA =
  /sshd(?:-session)?\[(\d+)\]: (?:Failed (?:password|publickey) for (?:invalid user )?\S+ from |Invalid user \S* from |Connection closed by (?:authenticating|invalid) user \S* |Disconnected from (?:authenticating|invalid) user \S* )(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)/i;

/** Função pura: conta tentativas (sessões distintas) e IPs distintos nas linhas do auth.log. */
export function contarLinhas(
  texto: string,
  ignorarIps: string[] = [],
  janela: { desde?: number; ate?: number } = {},
): { tentativas: number; ipsDistintos: number; desde: string } {
  const sessoes = new Set<string>();
  const ips = new Set<string>();
  let desde = '';
  const linhas = texto.split('\n');
  const daEquipa = new Set(ignorarIps);
  for (const linha of linhas) {
    const a = ACEITE.exec(linha);
    if (a) daEquipa.add(a[1]);
  }
  for (const linha of linhas) {
    const m = FALHA.exec(linha);
    if (!m || daEquipa.has(m[2])) continue;
    if (janela.desde !== undefined || janela.ate !== undefined) {
      const t = Date.parse(linha.split(' ')[0]);
      if (Number.isNaN(t) || (janela.desde !== undefined && t < janela.desde) || (janela.ate !== undefined && t > janela.ate)) continue;
    }
    sessoes.add(m[1]);
    ips.add(m[2]);
    if (!desde) desde = linha.split(' ')[0];
  }
  return { tentativas: sessoes.size, ipsDistintos: ips.size, desde };
}

let cache: { texto: string; em: number } | undefined;

function ssh(host: string, user: string, comando: string): Promise<string> {
  return new Promise((ok, falha) =>
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', `${user}@${host}`, comando],
      { timeout: 20_000, maxBuffer: 64 * 1024 * 1024 },
      (erro, stdout) => (erro ? falha(erro) : ok(stdout)),
    ),
  );
}

const FICHEIROS = ['/var/log/auth.log.1', '/var/log/auth.log'];

function sudoCat(ficheiro: string): Promise<string> {
  return new Promise((ok) =>
    execFile('sudo', ['-n', 'cat', ficheiro], { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }, (erro, stdout) => ok(erro ? '' : stdout)),
  );
}

/** Lê na própria máquina: diretamente se o utilizador estiver no grupo adm, senão com sudo -n. Ficheiro em falta = vazio. */
async function lerLocal(): Promise<string> {
  const partes: string[] = [];
  for (const f of FICHEIROS) {
    try {
      partes.push(await readFile(f, 'utf8'));
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') partes.push(await sudoCat(f));
    }
  }
  return partes.join('\n');
}

/** Texto do auth.log do isco, por ssh (execFile, sem shell) ou local. Cache de 30 s. */
async function lerAuthLog(): Promise<string> {
  if (cache && Date.now() - cache.em < 30_000) return cache.texto;
  carregarEnv();
  const host = process.env.ISCO_HOST;
  const user = process.env.ISCO_SSH_USER || 'ubuntu';
  if (!host) throw new Error('ISCO_HOST em falta no .env');
  // auth.log + rodado (auth.log.1), para não perder a manhã se o logrotate correr.
  // "; true": se o auth.log.1 ainda não existir, o cat sai com erro mas o auth.log vem na mesma.
  const texto = host === 'local' ? await lerLocal() : await ssh(host, user, 'sudo -n cat /var/log/auth.log.1 /var/log/auth.log 2>/dev/null; true');
  cache = { texto, em: Date.now() };
  return texto;
}

const ipsIgnorados = () => (process.env.ISCO_IGNORAR_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Tentativas desde que o isco foi ligado; com janela, só nesse intervalo (relógio de exposição). */
export async function contarTentativas(janela: { desde?: number; ate?: number } = {}): Promise<ContagemIsco> {
  const r = contarLinhas(await lerAuthLog(), ipsIgnorados(), janela);
  return { ...r, lidoEm: new Date().toISOString() };
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function paginaIsco(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const instante = (n: string) => (q.get(n) && !Number.isNaN(Date.parse(q.get(n)!)) ? Date.parse(q.get(n)!) : undefined);
  const c = await contarTentativas({ desde: instante('desde'), ate: instante('ate') });
  if (q.has('json')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(c));
    return;
  }
  const desde = c.desde ? new Date(c.desde).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' }) : '—';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="pt"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Isco</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f14;color:#e8eef5;font-family:system-ui,sans-serif;text-align:center}
.n{font-size:clamp(4rem,18vw,12rem);font-weight:800;color:#ff5a4f;line-height:1}.s{font-size:1.4rem;opacity:.85}.p{opacity:.5;margin-top:2rem}</style>
<div><div class="n">${c.tentativas}</div><div class="s">tentativas de entrada numa VM nova, desde as ${escapar(desde)}</div>
<div class="s">de ${c.ipsDistintos} IPs diferentes</div><div class="p">medido em ${escapar(new Date(c.lidoEm).toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' }))}</div></div></html>`);
}
