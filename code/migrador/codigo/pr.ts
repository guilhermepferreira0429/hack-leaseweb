// Migrador de código, passo 4: entregar a alteração como pull request. Nunca há push para main.
// Trabalha numa worktree temporária, num ramo novo (migrador/leaseweb-<id>-<hora>) que sai do origin/main:
// o PR só leva a alteração do migrador, nunca commits locais que o revisor ainda não enviou.
// A pasta de trabalho da equipa não muda.
// Por omissão só simula (escreve o diff e diz o que faria). O PR real só com MIGRADOR_PR=real no .env.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { Alteracao } from './propor';

export type Executar = (comando: string, args: string[], cwd: string) => Promise<string>;

const executarReal: Executar = async (comando, args, cwd) => {
  const { stdout } = await promisify(execFile)(comando, args, { cwd, maxBuffer: 4 * 1024 * 1024 });
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
  if (!pasta || isAbsolute(pasta) || pasta.split('/').includes('..')) throw new Error(`a app tem de estar dentro do repo: ${pasta}`);
  const ramo = nomeRamo(pedido.id, opcoes.agora);
  const ficheiros = pedido.alteracoes.map((a) => `${pasta}/${a.ficheiro}`);
  if (ficheiros.length === 0) throw new Error('não há nada para mudar: o PR não se abre');
  if (ficheiros.some((f) => f.split('/').includes('..'))) throw new Error('um ficheiro do PR sai da pasta da app');

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
    const noGitHub = await git('git', ['show', `${BASE}:${pasta}/${a.ficheiro}`], opcoes.raizRepo).catch(() => undefined);
    if (noGitHub === undefined || noGitHub.trim() !== a.antes.trim()) {
      throw new Error(`${pasta}/${a.ficheiro} no ${BASE} não é igual ao local: falta o push do revisor antes do PR`);
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
