// Decisor de destino (nível B): self-hosted na VM da Leaseweb ou serviço gerido europeu.
// As regras decidem (docs/decisor-destino.md), pela ordem; a primeira que se aplicar ganha. A IA só explica depois.
// Nada é lido de máquinas: a capacidade da VM chega como parâmetro.
import type { PlanoTraducao } from '../tipos';
import {
  DIAS_VALIDADE_PRECO,
  GERIDO_EUROPEU,
  GERIDO_LEASEWEB,
  HORAS_MES,
  LEASEWEB_POR_CONFIRMAR,
  MARGEM_RAM,
  RECURSOS,
  type OpcaoGerida,
  type ServicoDestino,
} from './tabelas';

export type Criticidade = 'alta' | 'media' | 'baixa';

export type EntradaServico = {
  servico: ServicoDestino;
  /** Nome para o dono, ex.: "encomendas". Por omissão, o nome do serviço. */
  nome?: string;
  /** Tamanho dos dados em GB (para o Valkey, os dados em RAM). */
  dadosGb?: number;
  /** Por omissão: base de dados = alta; o resto = média. */
  criticidade?: Criticidade;
  /** Por omissão: base de dados = sim; o resto = não. */
  dadosPessoais?: boolean;
  /** Por omissão: derivado da criticidade (alta -> sim). */
  altaDisponibilidade?: boolean;
};

export type CapacidadeVm = { ramLivreGb: number; vcpuLivres: number; discoLivreGb: number };

export type EntradaDecisor = {
  servicos: EntradaServico[];
  vm: CapacidadeVm;
  /** O dono já tem backups dos dados? */
  temBackups: boolean;
  /** 'tudo-self-hosted' é o botão do dono; por omissão, 'recomendado'. */
  modo?: 'recomendado' | 'tudo-self-hosted';
  /** Data de hoje, para a validade dos preços. Por omissão, agora. */
  hoje?: Date;
  /** País do cliente (ISO, ex.: 'PT'): desempata entre geridos com o mesmo preço. */
  paisCliente?: string;
};

export type Decisao = {
  servico: ServicoDestino;
  nome: string;
  servicoAws: string;
  alternativa: string;
  destino: 'self-hosted' | 'gerido';
  /** Quem aloja: 'Leaseweb' no self-hosted; no gerido, o fornecedor escolhido (ou 'por escolher' se a tabela não tiver). */
  fornecedor: string;
  plano?: string;
  /** Custo mensal estimado, só quando se pode calcular a partir da tabela (nunca inventado). */
  precoMes?: number;
  moeda?: 'EUR' | 'USD';
  /** Preço de tabela quando é por uso (ex.: € 0,01/GB) e não dá para fazer contas. */
  precoUnidade?: string;
  precoVistoEm?: string;
  precoAConfirmar: boolean;
  /** Número da regra que ganhou (1 a 4); 0 quando o dono escolheu tudo self-hosted. */
  numeroRegra: 0 | 1 | 2 | 3 | 4;
  /** Frase fixa da regra que ganhou. A IA reescreve-a depois. */
  regra: string;
  criticidade: Criticidade;
  dadosPessoais: boolean;
  /** O que o serviço precisa na VM. */
  precisa: { ramGb: number; discoGb: number };
  avisos: string[];
};

export const REGRAS = {
  1: 'Serviço crítico que precisa de alta disponibilidade: fica num serviço gerido.',
  2: 'Não cabe na VM deixando 25% da RAM livre: fica num serviço gerido.',
  3: 'Tem dados pessoais e não há backups: fica num serviço gerido, com backups e cifra.',
  4: 'Cabe na VM e não precisa de mais: fica self-hosted na VM da Leaseweb.',
  0: 'O dono escolheu tudo self-hosted.',
} as const;

const DIA_MS = 24 * 60 * 60 * 1000;

function necessidade(servico: ServicoDestino, dadosGb: number): { ramGb: number; discoGb: number } {
  const r = RECURSOS[servico];
  const ramGb = typeof r.ramGb === 'number' ? r.ramGb : dadosGb * r.ramGb.dadosVezes;
  const discoGb = r.disco.tipo === 'fator' ? dadosGb * r.disco.fator : r.disco.tipo === 'baixo' ? 0 : dadosGb;
  return { ramGb, discoGb };
}

/** Custo mensal a partir da tabela, quando dá para calcular. */
function custoMes(o: OpcaoGerida, dadosGb: number | undefined): number | undefined {
  const p = o.preco;
  if (p.tipo === 'mes') return p.valor;
  if (p.tipo === 'hora') return arred(p.valor * HORAS_MES);
  if (p.tipo === 'gb-mes' && dadosGb) return arred(p.valor * dadosGb);
  return undefined;
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

export function formatarNumero(v: number): string {
  const [inteiro, decimais = ''] = v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '').split('.');
  return `${inteiro},${decimais.padEnd(2, '0')}`;
}

/** Quantidade sem casas decimais inúteis: 125 -> "125", 0,75 -> "0,75". */
export function formatarQuantidade(v: number): string {
  return formatarNumero(arred(v)).replace(/,00$/, '');
}

function precoUnidade(o: OpcaoGerida): string | undefined {
  const p = o.preco;
  if (p.tipo !== 'gb-uso' && p.tipo !== 'gb-mes') return undefined;
  const valor = p.moeda === 'EUR' ? `€ ${formatarNumero(p.valor)}` : `${formatarNumero(p.valor)} $`;
  return p.tipo === 'gb-uso' ? `${valor}/GB` : `${valor}/GB/mês`;
}

/**
 * Do mais barato para o mais caro: preço conhecido em euros, depois em dólares (não se converte moeda), depois sem preço.
 * Empate: primeiro o do país do cliente; depois a ordem da tabela.
 */
export function ordenarGeridos(candidatas: OpcaoGerida[], dadosGb: number | undefined, paisCliente: string | undefined): OpcaoGerida[] {
  const chave = (o: OpcaoGerida, i: number) => {
    const custo = custoMes(o, dadosGb) ?? (o.preco.tipo === 'gb-uso' ? o.preco.valor : undefined);
    const grupo = custo === undefined ? 2 : o.preco.tipo !== 'a-confirmar' && o.preco.moeda === 'EUR' ? 0 : 1;
    return [grupo, custo ?? 0, o.pais === paisCliente ? 0 : 1, i] as const;
  };
  return candidatas
    .map((o, i) => ({ o, k: chave(o, i) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3])
    .map((x) => x.o);
}

/** "Para escolher o gerido": Leaseweb; senão o mais barato da tabela que cumpra os requisitos; empate pelo país do cliente. */
function escolherGerido(
  servico: ServicoDestino,
  precisaHA: boolean,
  dadosGb: number | undefined,
  paisCliente: string | undefined,
): { opcao?: OpcaoGerida; avisos: string[] } {
  const avisos: string[] = [];
  const leaseweb = GERIDO_LEASEWEB[servico];
  if (leaseweb) return { opcao: leaseweb, avisos };
  if (LEASEWEB_POR_CONFIRMAR.has(servico))
    avisos.push('Gerido da Leaseweb por confirmar: não o encontrámos na Public Cloud; se existir, passa a ser a escolha.');

  let candidatas = (GERIDO_EUROPEU[servico] ?? []).filter((o) => o.ue);
  if (candidatas.length === 0) {
    avisos.push('Não há serviço gerido europeu na tabela para isto: decide à mão.');
    return { avisos };
  }
  if (precisaHA) {
    const semExcluir = candidatas.filter((o) => o.altaDisponibilidade !== false);
    if (semExcluir.length > 0) candidatas = semExcluir;
    else avisos.push('Nenhuma opção da tabela garante alta disponibilidade.');
  }

  const opcao = ordenarGeridos(candidatas, dadosGb, paisCliente)[0]!;
  if (precisaHA && opcao.altaDisponibilidade !== true)
    avisos.push(`Alta disponibilidade a confirmar com a ${opcao.fornecedor}.`);
  return { opcao, avisos };
}

export function decidirDestino(entrada: EntradaDecisor): Decisao[] {
  const hoje = entrada.hoje ?? new Date();
  const tudoSelf = entrada.modo === 'tudo-self-hosted';
  let ramLivre = entrada.vm.ramLivreGb * (1 - MARGEM_RAM);
  let discoLivre = entrada.vm.discoLivreGb;

  return entrada.servicos.map((e) => {
    const r = RECURSOS[e.servico];
    const criticidade = e.criticidade ?? (r.baseDeDados ? 'alta' : 'media');
    const dadosPessoais = e.dadosPessoais ?? r.baseDeDados;
    const precisaHA = e.altaDisponibilidade ?? criticidade === 'alta';
    const precisa = necessidade(e.servico, e.dadosGb ?? 0);
    const cabe = precisa.ramGb <= ramLivre + 1e-9 && precisa.discoGb <= discoLivre + 1e-9;
    const avisos: string[] = [];
    if (e.dadosGb === undefined) avisos.push('Tamanho dos dados desconhecido: o disco contou como 0 GB.');
    if (r.nota) avisos.push(r.nota);
    const naoCabe = `Precisa de ${formatarQuantidade(precisa.ramGb)} GB de RAM e ${formatarQuantidade(precisa.discoGb)} GB de disco; a VM tem ${formatarQuantidade(ramLivre)} GB de RAM utilizáveis (com a margem de 25%) e ${formatarQuantidade(discoLivre)} GB de disco.`;

    const base = {
      servico: e.servico,
      nome: e.nome ?? e.servico,
      servicoAws: r.servicoAws,
      alternativa: r.alternativa,
      criticidade,
      dadosPessoais,
      precisa,
    };
    const selfHosted = (numeroRegra: 0 | 4): Decisao => {
      ramLivre -= precisa.ramGb;
      discoLivre -= precisa.discoGb;
      return {
        ...base,
        destino: 'self-hosted',
        fornecedor: 'Leaseweb',
        plano: `${r.alternativa} na VM`,
        precoAConfirmar: false,
        numeroRegra,
        regra: REGRAS[numeroRegra],
        avisos,
      };
    };

    if (tudoSelf) {
      if (!cabe) avisos.push(`Não cabe: ${naoCabe} Precisa de uma VM maior.`);
      if (dadosPessoais && !entrada.temBackups) avisos.push('Tem dados pessoais e não há backups: liga os backups antes de migrar.');
      if (precisaHA) avisos.push('É crítico e fica sem alta disponibilidade.');
      return selfHosted(0);
    }

    const numeroRegra: 1 | 2 | 3 | 4 =
      criticidade === 'alta' && precisaHA ? 1 : !cabe ? 2 : dadosPessoais && !entrada.temBackups ? 3 : 4;
    if (numeroRegra === 4) return selfHosted(4);
    if (numeroRegra === 2) avisos.push(naoCabe);

    const { opcao, avisos: avisosGerido } = escolherGerido(e.servico, precisaHA, e.dadosGb, entrada.paisCliente);
    avisos.push(...avisosGerido);
    const decisao: Decisao = {
      ...base,
      destino: 'gerido',
      fornecedor: opcao?.fornecedor ?? 'por escolher',
      precoAConfirmar: true,
      numeroRegra,
      regra: REGRAS[numeroRegra],
      avisos,
    };
    if (!opcao) return decisao;
    decisao.plano = opcao.plano;
    decisao.precoVistoEm = opcao.vistoEm;
    if (opcao.nota) avisos.push(opcao.nota);
    const dias = (hoje.getTime() - new Date(`${opcao.vistoEm}T00:00:00Z`).getTime()) / DIA_MS;
    if (opcao.preco.tipo === 'a-confirmar' || dias > DIAS_VALIDADE_PRECO) return decisao;
    decisao.precoAConfirmar = false;
    decisao.moeda = opcao.preco.moeda;
    const mes = custoMes(opcao, e.dadosGb);
    if (mes !== undefined) decisao.precoMes = mes;
    else decisao.precoUnidade = precoUnidade(opcao);
    return decisao;
  });
}

/** Os serviços que o tradutor mandou substituir, já na forma de entrada do decisor. */
const DO_TRADUTOR: Record<string, ServicoDestino> = {
  S3: 's3',
  SQS: 'fila',
  'RDS PostgreSQL': 'postgres',
  'Aurora PostgreSQL': 'postgres',
  'RDS MySQL': 'mysql',
  'ElastiCache Redis': 'redis',
  'Secrets Manager': 'segredos',
  SNS: 'nats',
};

export function servicosDoPlano(plano: PlanoTraducao): EntradaServico[] {
  return plano.substituir.flatMap((s) => {
    const servico = DO_TRADUTOR[s.servicoAws];
    return servico ? [{ servico, nome: s.origem.split('.').slice(1).join('.') }] : [];
  });
}
