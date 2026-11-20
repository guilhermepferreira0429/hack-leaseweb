// Migrador de código, passo 4: entregar a alteração como pull request. Nunca há push para main.
// Trabalha numa worktree temporária num ramo novo (migrador/leaseweb-<id>): a pasta de trabalho da equipa não muda.
// Por omissão só simula (escreve o diff e diz o que faria). O PR real só com MIGRADOR_PR=real no .env.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  /** Sufixo do ramo (o id do pedido de migração). */
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
const RAMOS_PROIBIDOS = new Set(['main', 'master']);

export async function abrirPR(
  pedido: PedidoPR,
  opcoes: { raizRepo: string; real?: boolean; diff: string; executar?: Executar },
): Promise<ResultadoPR> {
  const ramo = `${PREFIXO_RAMO}${pedido.id.replace(/[^A-Za-z0-9-]/g, '')}`;
  if (!ramo.startsWith(PREFIXO_RAMO) || RAMOS_PROIBIDOS.has(ramo)) throw new Error(`ramo recusado: ${ramo}`);
  const ficheiros = pedido.alteracoes.map((a) => `${pedido.dirAppNoRepo}/${a.ficheiro}`);
  if (ficheiros.length === 0) throw new Error('não há nada para mudar: o PR não se abre');

  if (!opcoes.real) {
    const pasta = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
    const diffEm = join(pasta, `${ramo.replace('/', '-')}.diff`);
    await writeFile(diffEm, `${pedido.titulo}\n\n${pedido.corpo}\n\n${opcoes.diff}\n`, 'utf8');
    return { ramo, ficheiros, simulado: true, diffEm };
  }

  const git = opcoes.executar ?? executarReal;
  const pasta = await mkdtemp(join(tmpdir(), 'migrador-pr-'));
  const arvore = join(pasta, 'arvore');
  await git('git', ['worktree', 'add', '-b', ramo, arvore, 'HEAD'], opcoes.raizRepo);
  try {
    for (const a of pedido.alteracoes) {
      const destino = join(arvore, pedido.dirAppNoRepo, a.ficheiro);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, a.depois, 'utf8');
    }
    await git('git', ['add', '--', ...ficheiros], arvore);
    await git('git', ['commit', '-m', pedido.titulo, '-m', pedido.corpo], arvore);
    // Só o ramo novo vai para o GitHub. O main só muda quando uma pessoa fizer merge do PR.
    await git('git', ['push', '-u', 'origin', `${ramo}:${ramo}`], arvore);
    const url = await git('gh', ['pr', 'create', '--base', 'main', '--head', ramo, '--title', pedido.titulo, '--body', pedido.corpo], arvore);
    return { ramo, ficheiros, simulado: false, url: url.split('\n').at(-1) };
  } finally {
    await git('git', ['worktree', 'remove', '--force', arvore], opcoes.raizRepo).catch(() => '');
    await rm(pasta, { recursive: true, force: true }).catch(() => {});
  }
}
