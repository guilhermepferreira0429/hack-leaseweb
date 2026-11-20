// GET /isco: quantas tentativas de entrada a VM isco recebeu desde que foi ligada, e de quantos IPs.
// Lê /var/log/auth.log por SSH (ISCO_HOST, ISCO_SSH_USER, só chave), ou da própria máquina com ISCO_HOST=local
// (quando o painel corre no isco, como a VM da organização). Ver docs/demo.md.
// Só números medidos; nada inventado.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { uptime } from 'node:os';
import QRCode from 'qrcode';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { carregarEnv } from '@mwbe/shared';
import { cabecalho, escapar, horaLisboa, numero } from './estilo';

export interface ContagemIsco {
  tentativas: number;
  ipsDistintos: number;
  desde: string;
  lidoEm: string;
  /** Quando a máquina isco arrancou (uptime), se se souber. */
  ligadaEm?: string;
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

let cache: { texto: string; ligadaEm?: string; em: number } | undefined;

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

const SEPARADOR = '---auth.log---';

/** Hora de arranque a partir do 1.º número de /proc/uptime (segundos desde o arranque). */
export function ligadaDesde(procUptime: string, agora = Date.now()): string | undefined {
  const seg = Number(procUptime.trim().split(/\s+/)[0]);
  return Number.isFinite(seg) && seg > 0 ? new Date(agora - seg * 1000).toISOString() : undefined;
}

/** Texto do auth.log do isco e hora de arranque, por ssh (execFile, sem shell) ou local. Cache de 30 s. */
async function lerAuthLog(): Promise<{ texto: string; ligadaEm?: string }> {
  if (cache && Date.now() - cache.em < 30_000) return cache;
  carregarEnv();
  const host = process.env.ISCO_HOST;
  const user = process.env.ISCO_SSH_USER || 'ubuntu';
  if (!host) throw new Error('ISCO_HOST em falta no .env');
  let texto: string;
  let ligadaEm: string | undefined;
  if (host === 'local') {
    texto = await lerLocal();
    ligadaEm = new Date(Date.now() - uptime() * 1000).toISOString();
  } else {
    // auth.log + rodado (auth.log.1), para não perder a manhã se o logrotate correr.
    // "; true": se o auth.log.1 ainda não existir, o cat sai com erro mas o auth.log vem na mesma.
    const saida = await ssh(host, user, `cat /proc/uptime; echo ${SEPARADOR}; sudo -n cat /var/log/auth.log.1 /var/log/auth.log 2>/dev/null; true`);
    const [up, ...resto] = saida.split(`${SEPARADOR}\n`);
    texto = resto.join('');
    ligadaEm = ligadaDesde(up);
  }
  cache = { texto, ligadaEm, em: Date.now() };
  return cache;
}

const ipsIgnorados = () => (process.env.ISCO_IGNORAR_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Tentativas desde que o isco foi ligado; com janela, só nesse intervalo (relógio de exposição). */
export async function contarTentativas(janela: { desde?: number; ate?: number } = {}): Promise<ContagemIsco> {
  const { texto, ligadaEm } = await lerAuthLog();
  const r = contarLinhas(texto, ipsIgnorados(), janela);
  return { ...r, lidoEm: new Date().toISOString(), ...(ligadaEm ? { ligadaEm } : {}) };
}

const CSS = `body{min-height:100vh;padding:96px;display:flex;gap:80px;align-items:center}
.numero{flex:1;display:flex;flex-direction:column;gap:20px}.kicker{font-size:20px;letter-spacing:3px}
.n{font:400 clamp(120px,22vw,320px)/0.9 var(--serif);color:var(--atk)}.legenda{font-size:40px;max-width:24ch}
.nota{font:16px var(--mono);color:var(--faint)}
.qr{width:440px;flex:none;background:var(--panel);border-radius:20px;padding:36px;display:flex;flex-direction:column;gap:20px}
.qr .img{background:#fff;border-radius:12px;padding:16px}.qr .img svg{display:block;width:100%;height:auto}
.qr h2{margin:0;font:400 28px var(--serif)}.qr p{margin:0;font-size:18px;color:var(--muted)}
@media (max-width:1100px){body{padding:24px;flex-direction:column;align-items:flex-start;gap:32px}.legenda{font-size:24px}.qr{width:100%;max-width:440px}}`;

/** Cartão QR do grupo "Direção" (ideia wow 1): só aparece se TELEGRAM_CONVITE_URL estiver no .env. */
async function cartaoQr(): Promise<string> {
  const url = process.env.TELEGRAM_CONVITE_URL?.trim();
  if (!url || !/^https:\/\/t\.me\//.test(url)) return '';
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return `<div class="qr"><div class="img">${svg}</div><h2>Júri: aprovem vocês</h2><p>Entrem no grupo e carreguem em Fechar quando a Defesa pedir.</p></div>`;
}

export function renderizarIsco(c: ContagemIsco, qr = ''): string {
  const hora = (iso?: string) => (iso ? horaLisboa(iso, false) : '—');
  const desde = c.ligadaEm ?? c.desde;
  return `${cabecalho('Isco', CSS)}<meta http-equiv="refresh" content="30">
<div class="numero"><div class="kicker">VM isco · Leaseweb · ligada às ${hora(c.ligadaEm)}</div>
<div class="n">${numero(c.tentativas)}</div>
<div class="legenda">tentativas de entrada desde as ${hora(desde)}, de ${numero(c.ipsDistintos)} ${c.ipsDistintos === 1 ? 'IP' : 'IPs diferentes'}.</div>
<div class="nota">medido no auth.log às ${escapar(horaLisboa(c.lidoEm))} · sem contar os nossos logins</div></div>${qr}</body></html>`;
}

export async function paginaIsco(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const instante = (n: string) => (q.get(n) && !Number.isNaN(Date.parse(q.get(n)!)) ? Date.parse(q.get(n)!) : undefined);
  const c = await contarTentativas({ desde: instante('desde'), ate: instante('ate') });
  if (q.has('json')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(c));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderizarIsco(c, await cartaoQr()));
}
