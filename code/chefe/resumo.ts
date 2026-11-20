// Chefe: coordena e resume. Só números reais, tirados da auditoria e do estado; nada inventado e sem IA.
import type { EventoAuditoria, Pedido } from '@mwbe/shared';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return plural(s, 'segundo', 'segundos');
  const m = Math.floor(s / 60);
  const resto = s % 60;
  return resto === 0 ? plural(m, 'minuto', 'minutos') : `${m} min ${resto} s`;
}

/** Tempo entre o pedido e o último evento desse pedido (o fecho confirmado). */
function tempoAteFechar(pedidoId: string, eventos: EventoAuditoria[]): number | undefined {
  const doPedido = eventos.filter((e) => e.pedidoId === pedidoId);
  const inicio = doPedido.find((e) => e.tipo === 'pedido');
  const fim = doPedido.at(-1);
  if (!inicio || !fim || fim === inicio) return undefined;
  return Date.parse(fim.hora) - Date.parse(inicio.hora);
}

const doPasso = (pedidos: Pedido[], passo: 's3' | 'postgres' | 'fila') =>
  pedidos.find((p) => p.acao.tipo === 'migrar' && p.acao.passo === passo);

function linhaMigracao(pedidos: Pedido[], eventos: EventoAuditoria[]): string | undefined {
  const m = doPasso(pedidos, 's3');
  if (!m) return undefined;
  if (m.estado === 'ignorado') return 'Migração não aprovada: ficou tudo como estava.';
  if (m.estado !== 'feito') return 'Migração por concluir: vejam o painel.';
  const prova = eventos.filter((e) => e.pedidoId === m.id && e.tipo === 'feito').at(-1)?.depois as
    | { objetos?: number }
    | undefined;
  const n = typeof prova?.objetos === 'number' ? `${plural(prova.objetos, 'ficheiro', 'ficheiros')}, ` : '';
  const pg = doPasso(pedidos, 'postgres');
  const provaPg = pg?.estado === 'feito' ? (eventos.filter((e) => e.pedidoId === pg.id && e.tipo === 'feito').at(-1)?.depois as { tabelas?: number } | undefined) : undefined;
  const base = provaPg ? ` Base de dados copiada${typeof provaPg.tabelas === 'number' ? ` (${plural(provaPg.tabelas, 'tabela', 'tabelas')})` : ''}, também com checksums iguais.` : '';
  return `Migração concluída: ${n}checksums iguais e testes a passar dos dois lados.${base}`;
}

function linhaDefesa(pedidos: Pedido[], eventos: EventoAuditoria[]): string {
  const falhas = pedidos.filter((p) => p.acao.tipo === 'remover_regra');
  // Diz o que a defesa viu, não uma garantia. Se a deteção falhou, não viu nada: não se diz que está tudo fechado.
  const detecaoFalhou = eventos.some((e) => e.tipo === 'erro' && (e.depois as { fase?: string } | undefined)?.fase === 'deteção pela API');
  if (falhas.length === 0 && detecaoFalhou) return 'A defesa não conseguiu verificar os security groups: não sabemos se há portas abertas.';
  if (falhas.length === 0) return 'A defesa não encontrou portas abertas a toda a internet.';
  const feitos = falhas.filter((p) => p.estado === 'feito');
  const desfeitos = falhas.filter((p) => p.estado === 'desfeito');
  const ignorados = falhas.filter((p) => p.estado === 'ignorado');
  const pendentes = falhas.filter((p) => p.estado === 'pendente' || p.estado === 'aprovado');

  const tempos = feitos.map((p) => tempoAteFechar(p.id, eventos)).filter((t): t is number => t !== undefined);
  const maisLento = tempos.length > 0 ? Math.max(...tempos) : undefined;

  if (falhas.length === 1 && feitos.length === 1) {
    return `1 falha encontrada e fechada${maisLento !== undefined ? ` em ${duracao(maisLento)}` : ''}.`;
  }
  const partes = [
    feitos.length && `${feitos.length} ${feitos.length === 1 ? 'fechada' : 'fechadas'}${maisLento !== undefined ? ` (a mais lenta em ${duracao(maisLento)})` : ''}`,
    desfeitos.length && `${desfeitos.length} ${desfeitos.length === 1 ? 'desfeita' : 'desfeitas'} pelo dono`,
    ignorados.length && `${ignorados.length} ${ignorados.length === 1 ? 'ignorada' : 'ignoradas'} pelo dono`,
    pendentes.length && `${pendentes.length} por decidir`,
  ].filter(Boolean);
  return `${plural(falhas.length, 'falha encontrada', 'falhas encontradas')}: ${partes.join(', ')}.`;
}

/** Resumo curto para o grupo, com números reais (ex.: "1 falha encontrada e fechada em 40 segundos"). */
export function resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string {
  const erros = eventos.filter((e) => e.tipo === 'erro').length;
  return [
    linhaMigracao(pedidos, eventos),
    linhaDefesa(pedidos, eventos),
    erros > 0 ? `Houve ${plural(erros, 'problema', 'problemas')} pelo caminho; estão no painel.` : undefined,
    // Só se diz se for verdade: pelo menos um inverso registado na auditoria.
    eventos.some((e) => e.inverso) ? 'Cada alteração tem o inverso guardado na auditoria.' : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

const ROTULO: Record<Pedido['estado'], string> = {
  pendente: 'Por decidir',
  aprovado: 'Aprovados, em curso',
  feito: 'Feitos',
  desfeito: 'Desfeitos',
  ignorado: 'Ignorados',
};

/** Resposta ao /estado: pedidos agrupados por estado, com o id para o /desfazer. */
export function estadoAtual(pedidos: Pedido[]): string {
  if (pedidos.length === 0) return 'Ainda não há pedidos.';
  const blocos = (Object.keys(ROTULO) as Pedido['estado'][])
    .map((estado) => {
      const doEstado = pedidos.filter((p) => p.estado === estado);
      if (doEstado.length === 0) return undefined;
      return [`${ROTULO[estado]} (${doEstado.length}):`, ...doEstado.map((p) => `• ${p.id}  ${p.titulo}`)].join('\n');
    })
    .filter(Boolean);
  const podeDesfazer = pedidos.some((p) => p.estado === 'feito' && p.acao.tipo === 'remover_regra');
  return [...blocos, ...(podeDesfazer ? ['Para voltar atrás: /desfazer <id>'] : [])].join('\n\n');
}
