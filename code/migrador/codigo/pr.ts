// Migrador de código, passo 4: entregar a alteração como pull request. Nunca há push para main.
// Trabalha numa worktree temporária, num ramo novo (migrador/leaseweb-<id>-<hora>) que sai do origin/main:
// o PR só leva a alteração do migrador, nunca commits locais que o revisor ainda não enviou.
// A pasta de trabalho da equipa não muda.
// Por omissão só simula (escreve o diff e diz o que faria). O PR real só com MIGRADOR_PR=real no .env.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { Alteracao } from './propor';

/** Corre um comando. `env` acrescenta variáveis (o token vai sempre por aqui, nunca nos argumentos). */
export type Executar = (comando: string, args: string[], cwd: string, env?: Record<string, string>) => Promise<string>;

const executarReal: Executar = async (comando, args, cwd, env) => {
  const { stdout } = await promisify(execFile)(comando, args, { cwd, maxBuffer: 4 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env });
  return stdout.trim();
};

export interface PedidoPR {
  /** Pasta da app relativa à raiz do repo (ex.: code/exemplo-app). */
  dirAppNoRepo: string;
  alteracoes: Alteracao[];
  titulo: string;
  corpo: string;
  /** Parte do nome do ramo (o id do pedido de migração). */
  id: string;
}

export interface ResultadoPR {
  ramo: string;
  ficheiros: string[];
  simulado: boolean;
  url?: string;
  /** Onde ficou o diff quando é simulado. */
  diffEm?: string;
}

export const PREFIXO_RAMO = 'migrador/leaseweb-';
/** O PR sai sempre do main do GitHub (o último fetch), nunca do main local partilhado. */
export const BASE = 'origin/main';

/** Nome do ramo: prefixo fixo, id limpo e hora, para duas corridas com o mesmo id não colidirem. */
export function nomeRamo(id: string, agora: Date = new Date()): string {
  const hora = agora.toISOString().replace(/\D/g, '').slice(0, 14);
  const ramo = `${PREFIXO_RAMO}${id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32)}-${hora}`;
  if (!/^migrador\/leaseweb-[A-Za-z0-9-]+$/.test(ramo)) throw new Error(`ramo recusado: ${ramo}`);
  return ramo;
}

export async function abrirPR(
  pedido: PedidoPR,
  opcoes: { raizRepo: string; real?: boolean; diff: string; executar?: Executar; agora?: Date },
): Promise<ResultadoPR> {
  const pasta = pedido.dirAppNoRepo;
  // Vazio = a app está na raiz do repo. Absoluto ou com .. = fora do repo: recusa.
  if (isAbsolute(pasta) || pasta.split('/').includes('..')) throw new Error(`the app must be inside the repo: ${pasta}`);
  const noRepo = (ficheiro: string) => (pasta ? `${pasta}/${ficheiro}` : ficheiro);
  const ramo = nomeRamo(pedido.id, opcoes.agora);
  const ficheiros = pedido.alteracoes.map((a) => noRepo(a.ficheiro));
  if (ficheiros.length === 0) throw new Error('nothing to change: the PR is not opened');
  if (ficheiros.some((f) => f.split('/').includes('..'))) throw new Error('a PR file is outside the app folder');

  if (!opcoes.real) {
    const tmp = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
    const diffEm = join(tmp, `${ramo.replace('/', '-')}.diff`);
    await writeFile(diffEm, `${pedido.titulo}\n\n${pedido.corpo}\n\n${opcoes.diff}\n`, 'utf8');
    return { ramo, ficheiros, simulado: true, diffEm };
  }

  const git = opcoes.executar ?? executarReal;
  // Um ficheiro alterado tem de estar no GitHub igual ao que o migrador leu. Senão, o PR desfazia trabalho de alguém.
  for (const a of pedido.alteracoes) {
    if (a.antes === null) continue;
    const noGitHub = await git('git', ['show', `${BASE}:${noRepo(a.ficheiro)}`], opcoes.raizRepo).catch(() => undefined);
    // CRLF (Windows, core.autocrlf) e LF contam como iguais.
    const normal = (t: string) => t.replace(/\r\n/g, '\n').trim();
    if (noGitHub === undefined || normal(noGitHub) !== normal(a.antes)) {
      throw new Error(`${noRepo(a.ficheiro)} on ${BASE} differs from the local copy: push first, then open the PR`);
    }
  }

  const tmp = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
  const arvore = join(tmp, 'arvore');
  await git('git', ['worktree', 'add', '-b', ramo, arvore, BASE], opcoes.raizRepo);
  try {
    for (const a of pedido.alteracoes) {
      const destino = join(arvore, pasta, a.ficheiro);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, a.depois, 'utf8');
    }
    await git('git', ['add', '--', ...ficheiros], arvore);
    await git('git', ['commit', '-m', pedido.titulo, '-m', pedido.corpo], arvore);
    // Só o ramo novo vai para o GitHub (refspec explícito). O main só muda quando uma pessoa fizer merge do PR.
    await git('git', ['push', '-u', 'origin', `${ramo}:${ramo}`], arvore);
    const url = await git('gh', ['pr', 'create', '--base', 'main', '--head', ramo, '--title', pedido.titulo, '--body', pedido.corpo], arvore);
    return { ramo, ficheiros, simulado: false, url: url.split('\n').at(-1) };
  } finally {
    await git('git', ['worktree', 'remove', '--force', arvore], opcoes.raizRepo).catch(() => '');
    // O ramo local não faz falta (o remoto fica no GitHub); assim uma nova corrida não colide.
    await git('git', ['branch', '-D', ramo], opcoes.raizRepo).catch(() => '');
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- PR no repo próprio da app (docs/agentes/checkup-12h.md) ----------
// O PR abre num repo público só com a app (ex.: hack-leaseweb-exemplo-app), para o júri ver o diff no GitHub.
// Clone novo numa pasta temporária, ramo migracao/leaseweb-<hora>, commit, push só desse ramo e PR para main.
// O token (GITHUB_TOKEN_EXEMPLO, fine-grained, só esse repo) vai por variável de ambiente; sem token, usam-se as
// credenciais do git/gh da máquina.

export const PREFIXO_RAMO_APP = 'migracao/leaseweb-';

/** Chamada à API REST do GitHub. Injetável nos testes. */
export type ApiGitHub = (metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown) => Promise<any>;

/**
 * API do GitHub com o token (fetch, sem o gh CLI, que a VM não tem). O token só vai no cabeçalho
 * Authorization; os erros levam o método, o caminho e o estado HTTP, nunca o token.
 */
export function apiGitHub(token: string): ApiGitHub {
  return async (metodo, caminho, corpo) => {
    const r = await fetch(`https://api.github.com${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'hack-leaseweb-migrador',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho}: HTTP ${r.status} ${texto.slice(0, 200)}`);
    return texto ? JSON.parse(texto) : undefined;
  };
}

/** Com token (ou uma API injetada) usa a API do GitHub; sem nada, o gh CLI da máquina. */
function apiDe(opcoes: { token?: string; api?: ApiGitHub }): ApiGitHub | undefined {
  return opcoes.api ?? (opcoes.token ? apiGitHub(opcoes.token) : undefined);
}

export function nomeRamoApp(agora: Date = new Date()): string {
  return `${PREFIXO_RAMO_APP}${agora.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

/** Variáveis para o git e o gh usarem o token sem ele aparecer nos argumentos nem na URL. */
export function ambienteDoToken(token?: string): Record<string, string> | undefined {
  if (!token) return undefined;
  const basico = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GH_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basico}`,
  };
}

export async function abrirPRNoRepoDaApp(
  pedido: Omit<PedidoPR, 'dirAppNoRepo' | 'id'>,
  opcoes: { repo: string; token?: string; real?: boolean; diff: string; executar?: Executar; agora?: Date; api?: ApiGitHub },
): Promise<ResultadoPR> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(opcoes.repo)) throw new Error(`repo inválido: ${opcoes.repo}`);
  const ramo = nomeRamoApp(opcoes.agora);
  const ficheiros = pedido.alteracoes.map((a) => a.ficheiro);
  if (ficheiros.length === 0) throw new Error('nothing to change: the PR is not opened');
  if (ficheiros.some((f) => isAbsolute(f) || f.split('/').includes('..'))) throw new Error('a PR file is outside the app folder');

  if (!opcoes.real) {
    const tmp = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
    const diffEm = join(tmp, `${ramo.replace('/', '-')}.diff`);
    await writeFile(diffEm, `${pedido.titulo}\n\n${pedido.corpo}\n\n${opcoes.diff}\n`, 'utf8');
    return { ramo, ficheiros, simulado: true, diffEm };
  }

  const git = opcoes.executar ?? executarReal;
  const env = ambienteDoToken(opcoes.token);
  const tmp = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
  const arvore = join(tmp, 'app');
  try {
    await git('git', ['clone', '--depth', '1', `https://github.com/${opcoes.repo}.git`, arvore], tmp, env);
    // Um ficheiro alterado tem de estar no repo da app igual ao que o migrador leu. Senão, o PR desfazia trabalho.
    const normal = (t: string) => t.replace(/\r\n/g, '\n').trim();
    for (const a of pedido.alteracoes) {
      if (a.antes === null) continue;
      const noRepo = await readFile(join(arvore, a.ficheiro), 'utf8').catch(() => undefined);
      if (noRepo === undefined || normal(noRepo) !== normal(a.antes)) {
        throw new Error(`${a.ficheiro} on ${opcoes.repo} differs from the local copy: update the app repo before the PR`);
      }
    }
    await git('git', ['checkout', '-b', ramo], arvore, env);
    for (const a of pedido.alteracoes) {
      const destino = join(arvore, a.ficheiro);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, a.depois, 'utf8');
    }
    await git('git', ['add', '--', ...ficheiros], arvore, env);
    await git('git', ['-c', 'user.name=Migrador hack-leaseweb', '-c', 'user.email=migrador@users.noreply.github.com', 'commit', '-m', pedido.titulo, '-m', pedido.corpo], arvore, env);
    // Só o ramo novo (refspec explícito). O main do repo da app só muda com um merge decidido por uma pessoa.
    await git('git', ['push', 'origin', `${ramo}:${ramo}`], arvore, env);
    const api = apiDe(opcoes);
    if (api) {
      const pr = (await api('POST', `/repos/${opcoes.repo}/pulls`, { title: pedido.titulo, head: ramo, base: 'main', body: pedido.corpo })) as { html_url?: string };
      return { ramo, ficheiros, simulado: false, url: pr?.html_url };
    }
    const url = await git('gh', ['pr', 'create', '--repo', opcoes.repo, '--base', 'main', '--head', ramo, '--title', pedido.titulo, '--body', pedido.corpo], arvore, env);
    return { ramo, ficheiros, simulado: false, url: url.split('\n').at(-1) };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Aprovar PR (merge) e o seu inverso (um PR que reverte) ----------
// Só no repo da app e só depois de uma pessoa carregar em "Aprovar PR" no Telegram. O inverso não reescreve
// a história: abre um PR novo com o revert, e o merge desse volta a ser decisão de uma pessoa.

export async function aprovarPR(
  repo: string,
  numero: number,
  opcoes: { token?: string; executar?: Executar; cwd?: string; api?: ApiGitHub } = {},
): Promise<{ commit?: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(numero > 0)) throw new Error(`PR inválido: ${repo}#${numero}`);
  const api = apiDe(opcoes);
  if (api) {
    const pr = (await api('GET', `/repos/${repo}/pulls/${numero}`)) as { head?: { ref?: string } };
    const m = (await api('PUT', `/repos/${repo}/pulls/${numero}/merge`, { merge_method: 'squash' })) as { sha?: string };
    const ramo = pr?.head?.ref;
    // Só se apaga um ramo do migrador, nunca o main.
    if (ramo && ramo.startsWith(PREFIXO_RAMO_APP)) await api('DELETE', `/repos/${repo}/git/refs/heads/${ramo}`).catch(() => undefined);
    return { commit: m?.sha && /^[0-9a-f]{7,40}$/.test(m.sha) ? m.sha : undefined };
  }
  const gh = opcoes.executar ?? executarReal;
  const env = ambienteDoToken(opcoes.token);
  const cwd = opcoes.cwd ?? tmpdir();
  await gh('gh', ['pr', 'merge', String(numero), '--repo', repo, '--squash', '--delete-branch'], cwd, env);
  const commit = await gh('gh', ['pr', 'view', String(numero), '--repo', repo, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'], cwd, env).catch(
    () => '',
  );
  return { commit: /^[0-9a-f]{7,40}$/.test(commit.trim()) ? commit.trim() : undefined };
}

export async function reverterPR(
  repo: string,
  numero: number,
  commit: string | undefined,
  opcoes: { token?: string; executar?: Executar; agora?: Date; api?: ApiGitHub } = {},
): Promise<{ url?: string; ramo: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(numero > 0)) throw new Error(`PR inválido: ${repo}#${numero}`);
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`I do not know which commit to revert for PR #${numero}`);
  const git = opcoes.executar ?? executarReal;
  const env = ambienteDoToken(opcoes.token);
  const ramo = `${PREFIXO_RAMO_APP}reverter-${numero}-${(opcoes.agora ?? new Date()).toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const tmp = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
  const arvore = join(tmp, 'app');
  try {
    await git('git', ['clone', `https://github.com/${repo}.git`, arvore], tmp, env);
    await git('git', ['checkout', '-b', ramo], arvore, env);
    await git('git', ['-c', 'user.name=Migrador hack-leaseweb', '-c', 'user.email=migrador@users.noreply.github.com', 'revert', '--no-edit', commit], arvore, env);
    await git('git', ['push', 'origin', `${ramo}:${ramo}`], arvore, env);
    const titulo = `Revert PR #${numero} (requested by the owner with /desfazer)`;
    const corpo = `Undoes PR #${numero}, as the owner asked in Telegram. The main branch only changes when someone merges this PR.`;
    const api = apiDe(opcoes);
    if (api) {
      const pr = (await api('POST', `/repos/${repo}/pulls`, { title: titulo, head: ramo, base: 'main', body: corpo })) as { html_url?: string };
      return { url: pr?.html_url, ramo };
    }
    const url = await git('gh', ['pr', 'create', '--repo', repo, '--base', 'main', '--head', ramo, '--title', titulo, '--body', corpo], arvore, env);
    return { url: url.split('\n').at(-1), ramo };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
