// Mensagem do migrador no Telegram com a decisão de destino (modelo de docs/decisor-destino.md).
// Determinística. Os botões ([Aprovar recomendado] [Tudo self-hosted] [Porquê?]) são do telegram.ts, não vão no texto.
import { formatarNumero, formatarQuantidade, type CapacidadeVm, type Decisao } from './decidir';

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

function data(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function textoPreco(d: Decisao): string {
  if (d.precoAConfirmar) return 'preço a confirmar';
  const visto = d.precoVistoEm ? ` (preço visto a ${data(d.precoVistoEm)})` : '';
  if (d.precoMes !== undefined)
    return d.moeda === 'USD' ? `cerca de ${formatarNumero(d.precoMes)} $/mês${visto}` : `cerca de € ${formatarNumero(d.precoMes)}/mês${visto}`;
  if (d.precoUnidade) return `${d.precoUnidade}${visto}`;
  return 'preço a confirmar';
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
  const qualidades = [d.criticidade === 'alta' ? 'é crítica' : '', d.dadosPessoais ? 'tem dados pessoais' : ''].filter(Boolean);
  if (d.servico === 'postgres' || d.servico === 'mysql' || d.servico === 'documentdb' || d.servico === 'dynamodb')
    return `A base de dados${nome ? ` ${nome}` : ''}${qualidades.length ? ` ${qualidades.join(' e ')}` : ''}`;
  return nome ? `O ${d.servicoAws} (${nome})` : `O ${d.servicoAws}`;
}

export function mensagemDestino(decisoes: Decisao[], vm: CapacidadeVm): string {
  const partes = [`A tua VM tem ${formatarQuantidade(vm.ramLivreGb)} GB de RAM livres.`];
  const self = decisoes.filter((d) => d.destino === 'self-hosted');
  const nomesSelf = [...new Set(self.map((d) => d.alternativa))].map((a) => `o ${a}`);
  if (nomesSelf.length > 0) {
    const frase = juntar(nomesSelf);
    partes.push(`${frase[0]!.toUpperCase()}${frase.slice(1)} ${nomesSelf.length === 1 ? 'fica' : 'ficam'} nela.`);
  }
  if (decisoes.length > 0 && decisoes.every((d) => d.numeroRegra === 0)) partes.push(REGRA_TUDO_SELF);

  // Uma frase por serviço gerido; o porquê aparece uma vez por regra diferente, no fim.
  const geridos = decisoes.filter((x) => x.destino === 'gerido');
  for (const d of geridos) {
    const proposta =
      d.fornecedor === 'por escolher'
        ? 'não há gerido europeu na tabela; decide à mão'
        : `proponho ${d.fornecedor} ${d.plano}, ${textoPreco(d)}`;
    partes.push(`${sujeito(d)}: ${proposta}.`);
  }
  const regras = [...new Set(geridos.map((d) => d.regra))];
  if (regras.length > 0) partes.push(`Porquê: ${regras.join(' ')}`);
  const comAvisos = decisoes.filter((d) => d.numeroRegra === 0 && d.avisos.some((a) => a.startsWith('Não cabe')));
  if (comAvisos.length > 0) partes.push(`Atenção: ${juntar(comAvisos.map((d) => `o ${d.alternativa}`))} não cabe na VM com a margem de 25%.`);
  return partes.join(' ');
}

const REGRA_TUDO_SELF = 'Escolheste tudo self-hosted.';
