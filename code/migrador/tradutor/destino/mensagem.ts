// Mensagem do migrador no Telegram com a decisão de destino (modelo de docs/decisor-destino.md), em inglês
// (a demo é em inglês). Determinística. Os botões ("Approve plan" / "Ignore") são do telegram.ts, não vão no texto.
import { formatarNumero, formatarQuantidade, type CapacidadeVm, type Decisao } from './decidir';

/** Marca do fornecedor quando a tabela não tem gerido (ver decidir.ts). */
export const POR_ESCOLHER = 'to be chosen';

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} and ${itens.at(-1)}`;
}

function data(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function textoPreco(d: Decisao): string {
  if (d.precoAConfirmar) return 'price to be confirmed';
  const visto = d.precoVistoEm ? ` (price seen on ${data(d.precoVistoEm)})` : '';
  if (d.precoMes !== undefined)
    return d.moeda === 'USD' ? `about $${formatarNumero(d.precoMes)}/month${visto}` : `about €${formatarNumero(d.precoMes)}/month${visto}`;
  if (d.precoUnidade) return `${d.precoUnidade}${visto}`;
  return 'price to be confirmed';
}

/** O nome só acrescenta se não repetir o serviço (ex.: "Secrets Manager" ou o nome por omissão "segredos"). */
function nomeProprio(d: Decisao): string | undefined {
  const normal = (t: string) => t.trim().toLowerCase();
  const nome = normal(d.nome);
  if (!nome || [d.servico, d.servicoAws, d.alternativa].some((x) => normal(x) === nome)) return undefined;
  return d.nome.trim();
}

function sujeito(d: Decisao): string {
  const nome = nomeProprio(d);
  const qualidades = [d.criticidade === 'alta' ? 'is critical' : '', d.dadosPessoais ? 'holds personal data' : ''].filter(Boolean);
  if (d.servico === 'postgres' || d.servico === 'mysql' || d.servico === 'documentdb' || d.servico === 'dynamodb')
    return `The${nome ? ` ${nome}` : ''} database${qualidades.length ? ` ${qualidades.join(' and ')}` : ''}`;
  return nome ? `${d.servicoAws} (${nome})` : d.servicoAws;
}

export function mensagemDestino(decisoes: Decisao[], vm: CapacidadeVm): string {
  const partes = [`Your VM has ${formatarQuantidade(vm.ramLivreGb)} GB of free RAM.`];
  const self = decisoes.filter((d) => d.destino === 'self-hosted');
  const nomesSelf = [...new Set(self.map((d) => d.alternativa))];
  if (nomesSelf.length > 0) partes.push(`${juntar(nomesSelf)} ${nomesSelf.length === 1 ? 'stays' : 'stay'} on it.`);
  if (decisoes.length > 0 && decisoes.every((d) => d.numeroRegra === 0)) partes.push(REGRA_TUDO_SELF);

  // Uma frase por serviço gerido; o porquê aparece uma vez por regra diferente, no fim.
  const geridos = decisoes.filter((x) => x.destino === 'gerido');
  for (const d of geridos) {
    const proposta =
      d.fornecedor === POR_ESCOLHER
        ? 'there is no European managed service in the table; decide by hand'
        : `I propose ${d.fornecedor} ${d.plano}, ${textoPreco(d)}`;
    partes.push(`${sujeito(d)}: ${proposta}.`);
  }
  const regras = [...new Set(geridos.map((d) => d.regra))];
  if (regras.length > 0) partes.push(`Why: ${regras.join(' ')}`);
  const comAvisos = decisoes.filter((d) => d.numeroRegra === 0 && d.avisos.some((a) => a.startsWith('Does not fit')));
  if (comAvisos.length > 0)
    partes.push(`Warning: ${juntar(comAvisos.map((d) => d.alternativa))} ${comAvisos.length === 1 ? 'does' : 'do'} not fit on the VM with the 25% margin.`);
  return partes.join(' ');
}

const REGRA_TUDO_SELF = 'You chose everything self-hosted.';
