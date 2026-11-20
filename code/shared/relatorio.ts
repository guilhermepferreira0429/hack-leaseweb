// Relatório do incidente no grupo "Direção", no formato acordado com o David.
// Só usa factos da auditoria (auditoria.jsonl): nada é inventado nem vem da IA.
// Se um passo não foi feito (recusado, falhou, ainda pendente), a linha diz isso em vez de o dar como feito.
// Cada passo feito e reversível leva um botão "Desfazer <passo>" (callback_data = desfazer:<pedidoId>).
//
// Formato (exemplo com todos os passos feitos):
//
//   🛡️ Incidente contido — <hora>
//
//   Alguém entrou no servidor <nome> como "<utilizador>" vindo de <ip>,
//   depois de <N> tentativas falhadas.
//
//   Em <X>s fiz, por esta ordem:
//   • bloqueei <ip> na firewall do servidor
//   • terminei a sessão do atacante
//   • bloqueei a conta "<utilizador>"
//   • desliguei o login por palavra-passe (só chave SSH)
//   • fechei o SSH à Internet na Leaseweb (só o vosso IP entra)
//   • pus em quarentena <F> ficheiro(s) que deixou
//
//   A migração terminou às <hora>. Mais nada foi alterado.
//   Desfazer qualquer passo: usa os botões abaixo.
import type { Agente } from './bus';
import type { Achado, EventoAuditoria } from './tipos';
import * as auditoria from './auditoria';
import * as telegram from './telegram';
import type { BotaoDesfazer } from './telegram';

/** A auditoria do ramo da defesa grava também `acao`; em main ainda não está em EventoAuditoria. */
type AcaoLida = { tipo: string; [campo: string]: unknown };
/** Campos do auth.log e inversos da VM só existem no ramo da defesa: aqui leem-se como opcionais. */
type AchadoLido = Achado & { ipOrigem?: string; utilizador?: string; tentativas?: number };
type Evento = Omit<EventoAuditoria, 'inverso'> & { acao?: AcaoLida; inverso?: { tipo: string } };

type Resultado = 'feito' | 'desfeito' | 'falhou' | 'ignorado' | 'pendente';

export type Passo = {
  pedidoId: string;
  /** Tipo da ação (ex.: bloquear_ip). Vem de `acao.tipo` ou, sem isso, do tipo do inverso. */
  acao: string;
  resultado: Resultado;
  /** Hora (ISO) do último evento do pedido. */
  hora: string;
  /** Texto do erro, se falhou. */
  motivo?: string;
  /** Há um inverso guardado que muda alguma coisa (não é 'irreversivel' nem 'nada'). */
  reversivel: boolean;
  dados: AcaoLida | undefined;
};

/** Inverso guardado -> ação que o criou (para eventos sem `acao`). */
const ACAO_DO_INVERSO: Record<string, string> = {
  criar_regra: 'remover_regra',
  desbloquear_ip: 'bloquear_ip',
  desbloquear_utilizador: 'bloquear_utilizador',
  repor_ssh_senha: 'desligar_ssh_senha',
  reabrir_ssh_mundo: 'fechar_ssh_mundo',
  repor_grupo: 'fechar_ssh_mundo',
};

/** Ordem do formato acordado. Ações fora desta lista vão para o fim, pela ordem da auditoria. */
const ORDEM = ['bloquear_ip', 'terminar_sessoes', 'bloquear_utilizador', 'desligar_ssh_senha', 'fechar_ssh_mundo', 'remover_regra', 'quarentena'];

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '??:??' : d.toTimeString().slice(0, 5);
}

function achadoDe(e: Evento): AchadoLido | undefined {
  const d = e.depois as { achado?: AchadoLido } | undefined;
  return d && typeof d === 'object' && d.achado && typeof d.achado === 'object' ? d.achado : undefined;
}

function motivoDe(e: Evento): string | undefined {
  const d = e.depois;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object') return texto((d as { erro?: unknown }).erro) ?? texto((d as { motivo?: unknown }).motivo);
  return undefined;
}

/** Resultado a partir do tipo do evento. Aceita 'feito' e o formato do ramo da defesa ('<acao>' sem ':inicio'). */
function resultadoDe(e: Evento): Resultado | undefined {
  if (e.tipo === 'feito' || e.tipo === 'desfeito' || e.tipo === 'falhou' || e.tipo === 'ignorado') return e.tipo;
  if (e.tipo === 'recusado') return 'ignorado';
  // Ramo da defesa: registarAcao grava tipo = acao.tipo no fim (e "<acao>:inicio" antes de aplicar).
  if (e.acao && e.tipo === e.acao.tipo && e.depois !== undefined) return 'feito';
  return undefined;
}

function passoDe(pedidoId: string, eventos: Evento[]): Passo {
  let acao: string | undefined;
  let dados: AcaoLida | undefined;
  let resultado: Resultado = 'pendente';
  let horaFinal = eventos[0]?.hora ?? '';
  let motivo: string | undefined;
  let reversivel = false;
  for (const e of eventos) {
    if (e.acao?.tipo) {
      acao = e.acao.tipo;
      dados = e.acao;
    }
    if (e.inverso) {
      acao ??= ACAO_DO_INVERSO[e.inverso.tipo];
      reversivel = e.inverso.tipo !== 'irreversivel' && e.inverso.tipo !== 'nada';
    }
    const r = resultadoDe(e);
    if (r) {
      resultado = r;
      horaFinal = e.hora;
      motivo = r === 'falhou' ? motivoDe(e) : undefined;
    }
  }
  return { pedidoId, acao: acao ?? 'desconhecida', resultado, hora: horaFinal, motivo, reversivel, dados };
}

/** Linha "• …" de um passo, no tom do formato acordado. */
function linha(p: Passo, achado: AchadoLido | undefined): string {
  const ip = texto(p.dados?.ip) ?? achado?.ipOrigem ?? 'o IP do atacante';
  const utilizador = texto(p.dados?.utilizador) ?? achado?.utilizador ?? '?';
  // [o que foi feito, o que não foi feito]
  const frases: Record<string, [string, string]> = {
    bloquear_ip: [`bloqueei ${ip} na firewall do servidor`, `não bloqueei ${ip} na firewall do servidor`],
    terminar_sessoes: ['terminei a sessão do atacante', 'não terminei a sessão do atacante'],
    bloquear_utilizador: [`bloqueei a conta "${utilizador}"`, `não bloqueei a conta "${utilizador}"`],
    desligar_ssh_senha: ['desliguei o login por palavra-passe (só chave SSH)', 'não desliguei o login por palavra-passe'],
    fechar_ssh_mundo: ['fechei o SSH à Internet na Leaseweb (só o vosso IP entra)', 'não fechei o SSH à Internet na Leaseweb'],
    remover_regra: ['fechei a regra aberta à Internet na Leaseweb', 'não fechei a regra aberta à Internet na Leaseweb'],
    // TODO(David/Enio): não há ação de quarentena na lista fechada (shared/tipos.ts). Quando houver,
    // confirmar o nome da ação e o campo com o número de ficheiros (aqui assume-se `ficheiros`).
    quarentena: [
      `pus em quarentena ${String(Array.isArray(p.dados?.ficheiros) ? p.dados.ficheiros.length : (p.dados?.ficheiros ?? '?'))} ficheiro(s) que deixou`,
      'não pus em quarentena os ficheiros que deixou',
    ],
  };
  const [feito, naoFeito] = frases[p.acao] ?? [`fiz: ${p.acao}`, `não fiz: ${p.acao}`];
  switch (p.resultado) {
    case 'feito':
      return `• ${feito}${p.reversivel ? '' : ' (não se pode desfazer)'}`;
    case 'desfeito':
      return `• ${feito}, e desfiz às ${hora(p.hora)}`;
    case 'falhou':
      return `• ${naoFeito}: falhou${p.motivo ? ` (${p.motivo})` : ''}`;
    case 'ignorado':
      return `• ${naoFeito}: o pedido foi recusado`;
    case 'pendente':
      return `• ${naoFeito}: ainda à espera de aprovação`;
  }
}

function rotuloDesfazer(p: Passo, achado: AchadoLido | undefined): string {
  const ip = texto(p.dados?.ip) ?? achado?.ipOrigem;
  const r: Record<string, string> = {
    bloquear_ip: `Desfazer bloqueio${ip ? ` de ${ip}` : ' do IP'}`,
    bloquear_utilizador: 'Desfazer bloqueio da conta',
    desligar_ssh_senha: 'Desfazer login só por chave',
    fechar_ssh_mundo: 'Desfazer fecho do SSH',
    remover_regra: 'Desfazer fecho da regra',
    quarentena: 'Desfazer quarentena',
  };
  return r[p.acao] ?? `Desfazer ${p.acao}`;
}

export type Relatorio = { texto: string; botoes: BotaoDesfazer[]; passos: Passo[] };

/**
 * Monta o relatório de um incidente (um achado) a partir dos eventos da auditoria.
 * Os passos são os pedidos cujo evento 'pedido' traz `depois.achado.id === achadoId`.
 */
export function montarRelatorio(achadoId: string, eventos: EventoAuditoria[] = auditoria.ler()): Relatorio {
  const todos = eventos as unknown as Evento[];
  const porPedido = new Map<string, Evento[]>();
  for (const e of todos) {
    if (!e.pedidoId || e.pedidoId === '-') continue;
    const lista = porPedido.get(e.pedidoId) ?? [];
    lista.push(e);
    porPedido.set(e.pedidoId, lista);
  }

  let achado: AchadoLido | undefined;
  const pedidosDoIncidente: string[] = [];
  let migracao: string | undefined;
  for (const [pedidoId, evs] of porPedido) {
    const pedido = evs.find((e) => e.tipo === 'pedido');
    const a = pedido && achadoDe(pedido);
    if (a?.id === achadoId) {
      achado ??= a;
      pedidosDoIncidente.push(pedidoId);
    }
    const ehMigracao = pedido?.quem === 'migrador' || evs.some((e) => e.acao?.tipo === 'migrar');
    if (ehMigracao) {
      const feito = evs.filter((e) => e.tipo === 'feito' || (e.acao?.tipo === 'migrar' && resultadoDe(e) === 'feito')).at(-1);
      if (feito && (!migracao || feito.hora > migracao)) migracao = feito.hora;
    }
  }

  const passos = pedidosDoIncidente
    .map((id) => passoDe(id, porPedido.get(id)!))
    .sort((a, b) => {
      const ia = ORDEM.indexOf(a.acao);
      const ib = ORDEM.indexOf(b.acao);
      return (ia < 0 ? ORDEM.length : ia) - (ib < 0 ? ORDEM.length : ib);
    });
  const feitos = passos.filter((p) => p.resultado === 'feito' || p.resultado === 'desfeito');

  // Duração: do primeiro pedido do incidente ao último passo feito.
  const inicio = pedidosDoIncidente
    .map((id) => porPedido.get(id)!.find((e) => e.tipo === 'pedido')?.hora)
    .filter((h): h is string => Boolean(h))
    .sort()[0];
  const fim = feitos.map((p) => p.hora).sort().at(-1);
  const segundos = inicio && fim ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000)) : undefined;

  const l: string[] = [];
  // TODO(David): confirmar o título quando nenhum passo foi feito (o acordado só tem "contido").
  l.push(feitos.length ? `🛡️ Incidente contido — ${hora(fim!)}` : `⚠️ Incidente por conter — ${hora(new Date().toISOString())}`);
  l.push('');

  const servidor = achado?.alvo ?? '?';
  if (achado?.utilizador && achado.ipOrigem) {
    l.push(`Alguém entrou no servidor ${servidor} como "${achado.utilizador}" vindo de ${achado.ipOrigem}${achado.tentativas ? ',' : '.'}`);
    if (achado.tentativas) l.push(`depois de ${achado.tentativas} tentativas falhadas.`);
  } else {
    // TODO(David): o formato acordado só cobre uma entrada no servidor. Frase provisória para os outros achados.
    l.push(`Encontrei um problema no servidor ${servidor}${achado ? ` (porta ${achado.porta})` : ''}.`);
  }
  l.push('');

  l.push(segundos !== undefined ? `Em ${segundos}s fiz, por esta ordem:` : 'Por esta ordem:');
  for (const p of passos) l.push(linha(p, achado));
  if (!passos.length) l.push('• nenhum passo registado na auditoria');
  l.push('');

  // "Mais nada foi alterado" só se a auditoria o confirmar: nenhum outro pedido feito além deste incidente e da migração.
  const outros = [...porPedido.entries()].filter(
    ([id, evs]) => !pedidosDoIncidente.includes(id) && evs.some((e) => resultadoDe(e) === 'feito') && !evs.some((e) => e.tipo === 'pedido' && e.quem === 'migrador') && !evs.some((e) => e.acao?.tipo === 'migrar'),
  ).length;
  const final: string[] = [];
  if (migracao) final.push(`A migração terminou às ${hora(migracao)}.`);
  // TODO(David): confirmar a frase quando houve outras alterações (o acordado só tem "Mais nada foi alterado.").
  final.push(outros ? `Há mais ${outros} alteração(ões) na auditoria fora deste incidente.` : 'Mais nada foi alterado.');
  l.push(final.join(' '));

  const botoes: BotaoDesfazer[] = passos
    .filter((p) => p.resultado === 'feito' && p.reversivel)
    .map((p) => ({ texto: rotuloDesfazer(p, achado), pedidoId: p.pedidoId }));
  if (botoes.length) l.push('Desfazer qualquer passo: usa os botões abaixo.');

  return { texto: l.join('\n'), botoes, passos };
}

/** Publica o relatório no grupo "Direção" com um botão Desfazer por passo feito. */
export async function publicarRelatorio(achadoId: string, agente: Agente = 'defesa'): Promise<Relatorio> {
  const r = montarRelatorio(achadoId);
  await telegram.enviarComDesfazer(agente, r.texto, r.botoes);
  return r;
}
