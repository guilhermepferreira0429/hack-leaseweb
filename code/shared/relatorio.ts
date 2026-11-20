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

/** Nome simples do que está na porta, para o dono perceber sem saber o que é um security group. */
const NOME_PORTA: Record<number, string> = {
  22: 'remote access to the server',
  23: 'old-style remote access (Telnet)',
  80: 'the website',
  443: 'the website',
  445: 'file sharing',
  1433: 'the database',
  3306: 'the database',
  3389: 'remote desktop',
  5432: 'the database',
  5984: 'the database',
  6379: 'the cache',
  9200: 'search',
  27017: 'the database',
};

/** Porta (ou intervalo) que o passo mexeu, para nenhuma linha/ botão ser igual a outro. */
function portasDoPasso(p: Passo, achado?: AchadoLido): { numero?: number; texto?: string } {
  const r = p.dados?.regra as { startPort?: unknown; endPort?: unknown } | undefined;
  const inicio = typeof r?.startPort === 'number' ? r.startPort : undefined;
  const fim = typeof r?.endPort === 'number' ? r.endPort : inicio;
  if (inicio !== undefined) return inicio === fim ? { numero: inicio, texto: String(inicio) } : { texto: `${inicio}–${fim}` };
  if (achado?.porta) return { numero: achado.porta, texto: String(achado.porta) };
  return {};
}

/** Duração em linguagem de pessoa: segundos, minutos ou horas. */
function duracao(total: number): string {
  if (total < 60) return `${total} ${total === 1 ? 'second' : 'seconds'}`;
  const minutos = Math.round(total / 60);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? 'minute' : 'minutes'}`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** Linha "• …" de um passo, no tom do formato acordado. */
function linha(p: Passo, achado: AchadoLido | undefined): string {
  const ip = texto(p.dados?.ip) ?? achado?.ipOrigem ?? 'the attacker IP';
  const utilizador = texto(p.dados?.utilizador) ?? achado?.utilizador ?? '?';
  const { numero, texto: portas } = portasDoPasso(p, achado);
  const nome = numero !== undefined ? NOME_PORTA[numero] : undefined;
  const onde = nome && portas ? `${nome} (port ${portas})` : portas ? `port ${portas}` : 'the open entry';
  // [o que foi feito, o que não foi feito]
  const frases: Record<string, [string, string]> = {
    bloquear_ip: [`blocked the attacker (${ip}) from the server`, `did not block the attacker (${ip}) from the server`],
    terminar_sessoes: ['ended the session the attacker had open', 'did not end the session the attacker had open'],
    bloquear_utilizador: [`locked the account "${utilizador}" they used`, `did not lock the account "${utilizador}" they used`],
    desligar_ssh_senha: ['turned off password login (keys only now)', 'did not turn off password login'],
    fechar_ssh_mundo: ['closed remote access to the server from the Internet (only your IP gets in)', 'did not close remote access to the server from the Internet'],
    remover_regra: [`closed ${onde} to the Internet on the Leaseweb firewall`, `did not close ${onde} to the Internet on the Leaseweb firewall`],
    // TODO(David/Enio): não há ação de quarentena na lista fechada (shared/tipos.ts). Quando houver,
    // confirmar o nome da ação e o campo com o número de ficheiros (aqui assume-se `ficheiros`).
    quarentena: [
      `set aside ${String(Array.isArray(p.dados?.ficheiros) ? p.dados.ficheiros.length : (p.dados?.ficheiros ?? '?'))} file(s) they left behind`,
      'did not set aside the files they left behind',
    ],
  };
  const [feito, naoFeito] = frases[p.acao] ?? [`did: ${p.acao}`, `did not do: ${p.acao}`];
  switch (p.resultado) {
    case 'feito':
      return `• ${feito}${p.reversivel ? '' : ' (cannot be undone)'}`;
    case 'desfeito':
      return `• ${feito}, and undid it at ${hora(p.hora)}`;
    case 'falhou':
      return `• ${naoFeito}: failed${p.motivo ? ` (${p.motivo})` : ''}`;
    case 'ignorado':
      return `• ${naoFeito}: the request was declined`;
    case 'pendente':
      return `• ${naoFeito}: still awaiting approval`;
  }
}

function rotuloDesfazer(p: Passo, achado: AchadoLido | undefined): string {
  const ip = texto(p.dados?.ip) ?? achado?.ipOrigem;
  const { texto: portas } = portasDoPasso(p, achado);
  const r: Record<string, string> = {
    bloquear_ip: `Undo blocking the attacker${ip ? ` (${ip})` : ''}`,
    bloquear_utilizador: 'Undo locking the account',
    desligar_ssh_senha: 'Allow password login again',
    fechar_ssh_mundo: 'Undo closing remote access',
    remover_regra: portas ? `Undo closing port ${portas}` : 'Undo closing the port',
    quarentena: 'Undo quarantine',
  };
  return r[p.acao] ?? `Undo ${p.acao}`;
}

/** Assinatura da alteração: dois pedidos que mexem na mesma coisa contam como um passo. */
function assinatura(p: Passo): string {
  const d = p.dados as { securityGroupId?: unknown; ip?: unknown; utilizador?: unknown; regra?: Record<string, unknown> } | undefined;
  const r = d?.regra;
  const parte = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  return [p.acao, parte(d?.securityGroupId), parte(r?.startPort), parte(r?.endPort), parte(r?.source), parte(r?.protocol), parte(d?.ip), parte(d?.utilizador)].join('|');
}

/** De um grupo de pedidos iguais, fica o que chegou mais longe (feito > desfeito > pendente > ignorado > falhou). */
const PESO: Record<Resultado, number> = { feito: 5, desfeito: 4, pendente: 3, ignorado: 2, falhou: 1 };
function agruparPassos(lista: Passo[]): Passo {
  return [...lista].sort((a, b) => PESO[b.resultado] - PESO[a.resultado])[0];
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
  // Um passo por alteração: dois pedidos que fecharam a mesma regra não contam duas vezes.
  const porAssinatura = new Map<string, Passo[]>();
  for (const p of passos) {
    const chave = assinatura(p);
    porAssinatura.set(chave, [...(porAssinatura.get(chave) ?? []), p]);
  }
  const unicos = [...porAssinatura.values()].map(agruparPassos);
  const feitos = unicos.filter((p) => p.resultado === 'feito' || p.resultado === 'desfeito');

  // Duração: do primeiro pedido do incidente ao último passo feito.
  const inicio = pedidosDoIncidente
    .map((id) => porPedido.get(id)!.find((e) => e.tipo === 'pedido')?.hora)
    .filter((h): h is string => Boolean(h))
    .sort()[0];
  const fim = feitos.map((p) => p.hora).sort().at(-1);
  const segundos = inicio && fim ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000)) : undefined;

  const l: string[] = [];
  // Decidido (David): "por conter" usa a hora do último evento do incidente, não a hora atual.
  const ultimoEvento = pedidosDoIncidente
    .flatMap((id) => porPedido.get(id)!.map((e) => e.hora))
    .filter(Boolean)
    .sort()
    .at(-1);
  const horaTitulo = feitos.length ? (fim ?? ultimoEvento) : (ultimoEvento ?? inicio);
  l.push(
    feitos.length
      ? `🛡️ Incident contained — ${hora(horaTitulo ?? new Date().toISOString())}`
      : `⚠️ Incident not contained yet — ${hora(horaTitulo ?? new Date().toISOString())}`,
  );
  l.push('');

  // RELATORIO_NOME_SERVIDOR permite o nome amigável na demo; sem ele, fica o alvo real (IP/ID).
  const servidor = process.env.RELATORIO_NOME_SERVIDOR?.trim() || achado?.alvo || '?';
  if (achado?.utilizador && achado.ipOrigem) {
    l.push(`Someone logged into server ${servidor} as "${achado.utilizador}" from ${achado.ipOrigem}${achado.tentativas ? ',' : '.'}`);
    if (achado.tentativas) l.push(`after ${achado.tentativas} failed attempts.`);
  } else if (achado && (achado.tipo === 'porta-exposta' || achado.tipo === 'servico-exposto')) {
    const nome = NOME_PORTA[achado.porta];
    l.push(
      nome
        ? `I found a port open to anyone on the Internet on server ${servidor}: ${nome} (port ${achado.porta}).`
        : `I found port ${achado.porta} open to anyone on the Internet on server ${servidor}.`,
    );
  } else if (achado?.tipo === 'credenciais-por-defeito') {
    l.push(`I found factory-default credentials on server ${servidor} (port ${achado.porta}).`);
  } else if (achado?.tipo === 'isco-tocado') {
    l.push(`Server ${servidor} received login attempts.`);
  } else {
    l.push(`I found a problem on server ${servidor}${achado ? ` (port ${achado.porta})` : ''}.`);
  }
  l.push('');

  l.push(segundos !== undefined ? `In ${duracao(segundos)} I did the following, in order:` : 'In this order:');
  for (const p of unicos) l.push(linha(p, achado));
  if (!unicos.length) l.push('• no step recorded in the audit log');
  l.push('');

  // Prova, só com o que está na auditoria: quem aprovou, a verificação de fora, a confirmação do atacante
  // (evento do orquestrador) e a exposição desde que a infraestrutura nova ficou no ar. O que falta não aparece.
  const doIncidente = (e: Evento) => pedidosDoIncidente.includes(e.pedidoId);
  const prova: string[] = [];
  const aprovacao = todos.filter((e) => doIncidente(e) && e.tipo === 'aprovado').at(-1);
  if (aprovacao) {
    prova.push(
      aprovacao.quem === 'modo-noite'
        ? `• approved by night mode at ${hora(aprovacao.hora)} (no answer from the owner)`
        : `• approved by a person in Telegram at ${hora(aprovacao.hora)}`,
    );
  }
  const verificado = todos
    .filter((e) => doIncidente(e) && e.tipo === 'verificado' && (e.depois as { fase?: string } | undefined)?.fase === 'depois')
    .at(-1)?.depois as { porta?: number; estado?: string } | undefined;
  if (verificado?.estado) {
    prova.push(
      verificado.estado === 'open'
        ? `• checked from outside: port ${verificado.porta ?? '?'} still answers ✗`
        : `• checked from outside: port ${verificado.porta ?? '?'} no longer answers (${verificado.estado}) ✓`,
    );
  }
  const confirmacao = todos.filter((e) => doIncidente(e) && e.tipo === 'confirmacao-atacante').at(-1)?.depois as { chega?: boolean } | undefined;
  if (typeof confirmacao?.chega === 'boolean') {
    prova.push(confirmacao.chega ? '• the attacker tried again and can still reach it ✗' : '• the attacker tried again and can no longer reach it ✓');
  }
  const noAr = fim ? todos.filter((e) => e.tipo === 'infra-no-ar' && e.hora <= fim).at(-1) : undefined;
  if (noAr && fim) {
    prova.push(`• it was exposed for ${duracao(Math.max(0, Math.round((Date.parse(fim) - Date.parse(noAr.hora)) / 1000)))} since the new infrastructure went live`);
  }
  if (prova.length) l.push('Proof:', ...prova, '');

  // "Mais nada foi alterado" só se a auditoria o confirmar: nenhum outro pedido feito além deste incidente e da migração.
  const outros = [...porPedido.entries()].filter(
    ([id, evs]) => !pedidosDoIncidente.includes(id) && evs.some((e) => resultadoDe(e) === 'feito') && !evs.some((e) => e.tipo === 'pedido' && e.quem === 'migrador') && !evs.some((e) => e.acao?.tipo === 'migrar'),
  ).length;
  const final: string[] = [];
  if (migracao) final.push(`The migration finished at ${hora(migracao)}.`);
  // Decidido (David): quando há outras alterações, dizê-lo com o número, em vez de "Mais nada".
  const mais = outros === 1 ? 'is 1 other change recorded' : `are ${outros} other changes recorded`;
  final.push(outros ? `Besides this incident, there ${mais} in the audit log.` : 'Nothing else was changed.');
  l.push(final.join(' '));

  const botoes: BotaoDesfazer[] = unicos
    .filter((p) => p.resultado === 'feito' && p.reversivel)
    .map((p) => ({ texto: rotuloDesfazer(p, achado), pedidoId: p.pedidoId }));
  if (botoes.length) l.push('To undo any step, use the buttons below.');

  return { texto: l.join('\n'), botoes, passos: unicos };
}

/** Publica o relatório no grupo "Direção" com um botão Desfazer por passo feito. */
export async function publicarRelatorio(achadoId: string, agente: Agente = 'defesa'): Promise<Relatorio> {
  const r = montarRelatorio(achadoId);
  await telegram.enviarComDesfazer(agente, r.texto, r.botoes);
  return r;
}
