// Migrador de código (docs/ferramentas.md): os dados já estão na Leaseweb; isto muda a app para os usar.
// encontrar -> propor (regras fixas) -> validar -> PR. Os testes da app contra a Leaseweb são o verificar() do
// migrador, que o orquestrador corre antes; sem testes a passar, não há PR. Nunca há push para main.
import { relative, resolve, sep } from 'node:path';
import { encontrarUsosAws, type UsoAws } from './encontrar';
import { abrirPR, abrirPRNoRepoDaApp, type Executar, type ResultadoPR } from './pr';
import { proporAlteracao, validarAlteracao, type CausaCorrigida } from './propor';

export * from './encontrar';
export * from './propor';
export * from './pr';

export interface ResultadoCodigo {
  /** Quantos sítios do código e da configuração prendem a app à AWS. */
  usos: number;
  ficheiros: string[];
  /** O que fica fora do PR e porquê. */
  fora: string[];
  /** Regras que a alteração não cumpriu (vazio = ok). Com problemas, não há PR. */
  problemas: string[];
  /** Regras abertas a toda a Internet corrigidas na configuração da infraestrutura (a causa). */
  causas: number;
  pr?: ResultadoPR;
}

export interface OpcoesCodigo {
  /** Raiz do repo (para a worktree do PR). */
  raizRepo: string;
  /** Id do pedido de migração aprovado (nome do ramo). */
  id: string;
  /** Os mesmos testes da app passaram contra a Leaseweb. Sem isto, não há PR. */
  testesOk: boolean;
  /** PR real no GitHub (MIGRADOR_PR=real). Por omissão só simula. */
  real?: boolean;
  /** Repo próprio da app (dono/nome, ex.: MIGRADOR_PR_REPO). Com ele, o PR abre lá e não no repo do projeto. */
  repoApp?: string;
  /** Token só para o repo da app (GITHUB_TOKEN_EXEMPLO). Sem ele, usam-se as credenciais do git/gh da máquina. */
  token?: string;
  executar?: Executar;
}

function corpoPR(usos: UsoAws[], ficheiros: string[], fora: string[], causas: CausaCorrigida[]): string {
  const servicos = [...new Set(usos.map((u) => u.servico).filter((s) => s !== 'outro' && s !== 'credencial'))];
  return [
    'Proposto pelo migrador de código depois de os dados passarem para a Leaseweb, com o OK do dono no Telegram.',
    '',
    `Serviços: ${servicos.join(', ') || 'nenhum'}. Encontrei ${usos.length} sítios no código e na configuração que apontam para a AWS.`,
    `Ficheiros alterados: ${ficheiros.join(', ')}.`,
    'Os mesmos testes da app passam contra a Leaseweb.',
    ...(causas.length
      ? [
          '',
          'Segurança (a causa da falha que a defesa fechou pela API da Leaseweb):',
          ...causas.map((c) => `- ${c.ficheiro}: ${c.recurso}, porta ${c.porta}, deixa de estar aberta a toda a Internet; só ${c.via === 'sgApp' ? 'o grupo da app' : 'a subrede da app'} entra.`),
          'Sem esta correção, a porta voltava a abrir no próximo deploy.',
        ]
      : []),
    'Nenhum segredo vem neste PR: os valores reais vão só no .env.',
    ...(fora.length ? ['', 'Fica fora deste PR:', ...fora.map((f) => `- ${f}`)] : []),
  ].join('\n');
}

export async function migrarCodigo(dirApp: string, opcoes: OpcoesCodigo): Promise<ResultadoCodigo> {
  const usos = await encontrarUsosAws(dirApp);
  const proposta = await proporAlteracao(dirApp, usos);
  const ficheiros = proposta.alteracoes.map((a) => a.ficheiro);
  const problemas = validarAlteracao(proposta, usos);
  if (!opcoes.testesOk) problemas.push('os testes da app não passaram contra a Leaseweb');
  const base = { usos: usos.length, ficheiros, fora: proposta.fora, problemas, causas: proposta.causas.length };
  if (problemas.length || ficheiros.length === 0) return base;

  const titulo = 'Migrador: a app passa a usar os serviços na Leaseweb';
  const corpo = corpoPR(usos, ficheiros, proposta.fora, proposta.causas);
  if (opcoes.repoApp) {
    const pr = await abrirPRNoRepoDaApp(
      { alteracoes: proposta.alteracoes, titulo, corpo },
      { repo: opcoes.repoApp, token: opcoes.token, real: opcoes.real, diff: proposta.diff, executar: opcoes.executar },
    );
    return { ...base, pr };
  }

  const dirAppNoRepo = relative(resolve(opcoes.raizRepo), resolve(dirApp)).split(sep).join('/');
  const pr = await abrirPR(
    {
      dirAppNoRepo,
      alteracoes: proposta.alteracoes,
      titulo,
      corpo,
      id: opcoes.id,
    },
    { raizRepo: opcoes.raizRepo, real: opcoes.real, diff: proposta.diff, executar: opcoes.executar },
  );
  return { ...base, pr };
}
