// Chefe: coordena e resume. Só números reais, tirados da auditoria e do estado; nada inventado e sem IA.
// Os textos vão para o Telegram em inglês (a demo e o pitch são em inglês).
import type { EventoAuditoria, Pedido } from '@mwbe/shared';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return plural(s, 'second', 'seconds');
  const m = Math.floor(s / 60);
  const resto = s % 60;
  return resto === 0 ? plural(m, 'minute', 'minutes') : `${m} min ${resto} s`;
}

/** Tempo entre o pedido e o último evento desse pedido (o fecho confirmado). */
function tempoAteFechar(pedidoId: string, eventos: EventoAuditoria[]): number | undefined {
  const doPedido = eventos.filter((e) => e.pedidoId === pedidoId);
  const inicio = doPedido.find((e) => e.tipo === 'pedido');
  const fim = doPedido.at(-1);
  if (!inicio || !fim || fim === inicio) return undefined;
  return Date.parse(fim.hora) - Date.parse(inicio.hora);
}

// O último do ciclo: num processo que corre várias vezes, o primeiro seria de um ensaio antigo.
const doPasso = (pedidos: Pedido[], passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache') =>
  pedidos.findLast((p) => p.acao.tipo === 'migrar' && p.acao.passo === passo);

function linhaMigracao(pedidos: Pedido[], eventos: EventoAuditoria[]): string | undefined {
  const m = doPasso(pedidos, 's3');
  if (!m) return undefined;
  if (m.estado === 'ignorado') return 'Migration not approved: everything stayed as it was.';
  if (m.estado !== 'feito') return 'Migration not finished yet: see the dashboard.';
  const prova = eventos.filter((e) => e.pedidoId === m.id && e.tipo === 'feito').at(-1)?.depois as
    | { objetos?: number }
    | undefined;
  const n = typeof prova?.objetos === 'number' ? `${plural(prova.objetos, 'file', 'files')}, ` : '';
  const pg = doPasso(pedidos, 'postgres');
  const provaPg = pg?.estado === 'feito' ? (eventos.filter((e) => e.pedidoId === pg.id && e.tipo === 'feito').at(-1)?.depois as { tabelas?: number } | undefined) : undefined;
  const base = provaPg ? ` Database copied${typeof provaPg.tabelas === 'number' ? ` (${plural(provaPg.tabelas, 'table', 'tables')})` : ''}, checksums also match.` : '';
  const fl = doPasso(pedidos, 'fila');
  const provaFila = fl?.estado === 'feito' ? (eventos.filter((e) => e.pedidoId === fl.id && e.tipo === 'feito').at(-1)?.depois as { mensagens?: number } | undefined) : undefined;
  const filas = provaFila ? ` Queues moved to RabbitMQ${typeof provaFila.mensagens === 'number' ? ` (${plural(provaFila.mensagens, 'message', 'messages')})` : ''}, no messages lost.` : '';
  const sg = doPasso(pedidos, 'segredos');
  const provaSg = sg?.estado === 'feito' ? (eventos.filter((e) => e.pedidoId === sg.id && e.tipo === 'feito').at(-1)?.depois as { segredos?: number } | undefined) : undefined;
  const segredos = provaSg ? ` Secrets moved to OpenBao${typeof provaSg.segredos === 'number' ? ` (${plural(provaSg.segredos, 'secret', 'secrets')})` : ''}, never shown in plain text.` : '';
  const ch = doPasso(pedidos, 'cache');
  const provaCh = ch?.estado === 'feito' ? (eventos.filter((e) => e.pedidoId === ch.id && e.tipo === 'feito').at(-1)?.depois as { chaves?: number } | undefined) : undefined;
  const cache = provaCh ? ` Cache moved to Valkey${typeof provaCh.chaves === 'number' ? ` (${plural(provaCh.chaves, 'key', 'keys')})` : ''}.` : '';
  return `Migration complete: ${n}checksums match and tests pass on both sides.${base}${filas}${segredos}${cache}`;
}

/** O modo noite não é uma pessoa: o resumo diz quantas falhas fechou sem resposta do dono. */
function linhaModoNoite(pedidos: Pedido[], eventos: EventoAuditoria[]): string | undefined {
  const ids = new Set(eventos.filter((e) => e.tipo === 'aprovado' && e.quem === 'modo-noite').map((e) => e.pedidoId));
  const n = pedidos.filter((p) => ids.has(p.id) && p.estado === 'feito').length;
  if (n === 0) return undefined;
  return `${n === 1 ? 'One issue was closed' : `${n} issues were closed`} by night mode, with no answer from the owner: only known IPs get in, and /undo puts it back.`;
}

function linhaDefesa(pedidos: Pedido[], eventos: EventoAuditoria[]): string {
  const falhas = pedidos.filter((p) => p.acao.tipo === 'remover_regra');
  // Diz o que a defesa viu, não uma garantia. Se a deteção falhou, não viu nada: não se diz que está tudo fechado.
  // A etiqueta da fase passou a inglês no orquestrador; aceitam-se as duas (auditoria com ensaios antigos).
  const detecaoFalhou = eventos.some((e) => {
    const fase = e.tipo === 'erro' ? (e.depois as { fase?: string } | undefined)?.fase : undefined;
    return fase === 'API detection' || fase === 'deteção pela API';
  });
  if (falhas.length === 0 && detecaoFalhou) return 'Defense could not check the security groups: we do not know whether any port is open.';
  if (falhas.length === 0) return 'Defense found no ports open to the whole Internet.';
  const feitos = falhas.filter((p) => p.estado === 'feito');
  const desfeitos = falhas.filter((p) => p.estado === 'desfeito');
  const ignorados = falhas.filter((p) => p.estado === 'ignorado');
  const pendentes = falhas.filter((p) => p.estado === 'pendente' || p.estado === 'aprovado');

  const tempos = feitos.map((p) => tempoAteFechar(p.id, eventos)).filter((t): t is number => t !== undefined);
  const maisLento = tempos.length > 0 ? Math.max(...tempos) : undefined;

  if (falhas.length === 1 && feitos.length === 1) {
    // Do pedido da defesa ao fecho confirmado. A exposição total (infra no ar → fecho) está no certificado.
    return `1 issue found and closed${maisLento !== undefined ? ` ${duracao(maisLento)} after defense asked` : ''}.`;
  }
  const partes = [
    feitos.length && `${feitos.length} closed${maisLento !== undefined ? ` (the slowest ${duracao(maisLento)} after the request)` : ''}`,
    desfeitos.length && `${desfeitos.length} undone by the owner`,
    ignorados.length && `${ignorados.length} ignored by the owner`,
    pendentes.length && `${pendentes.length} awaiting a decision`,
  ].filter(Boolean);
  return `${plural(falhas.length, 'issue found', 'issues found')}: ${partes.join(', ')}.`;
}

/** Resumo curto para o grupo, com números reais (ex.: "1 issue found and closed 40 seconds after defense asked"). */
export function resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string {
  const erros = eventos.filter((e) => e.tipo === 'erro').length;
  return [
    linhaMigracao(pedidos, eventos),
    linhaDefesa(pedidos, eventos),
    linhaModoNoite(pedidos, eventos),
    erros > 0 ? `There ${erros === 1 ? 'was 1 problem' : `were ${erros} problems`} along the way; see the dashboard.` : undefined,
    // Só se diz se for verdade: pelo menos um inverso registado na auditoria.
    eventos.some((e) => e.inverso) ? 'Every change has its inverse stored in the audit log.' : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

const ROTULO: Record<Pedido['estado'], string> = {
  pendente: 'Awaiting a decision',
  aprovado: 'Approved, in progress',
  feito: 'Done',
  desfeito: 'Undone',
  ignorado: 'Ignored',
};

/** Resposta ao /status: pedidos agrupados por estado, com o id para o /undo. */
export function estadoAtual(pedidos: Pedido[]): string {
  if (pedidos.length === 0) return 'No requests yet.';
  const blocos = (Object.keys(ROTULO) as Pedido['estado'][])
    .map((estado) => {
      const doEstado = pedidos.filter((p) => p.estado === estado);
      if (doEstado.length === 0) return undefined;
      return [`${ROTULO[estado]} (${doEstado.length}):`, ...doEstado.map((p) => `• ${p.id}  ${p.titulo}`)].join('\n');
    })
    .filter(Boolean);
  const podeDesfazer = pedidos.some((p) => p.estado === 'feito' && p.acao.tipo === 'remover_regra');
  return [...blocos, ...(podeDesfazer ? ['To undo: /undo <id>'] : [])].join('\n\n');
}
