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
  22: 'o acesso remoto ao servidor',
  23: 'o acesso remoto antigo (Telnet)',
  80: 'o site',
  443: 'o site',
  445: 'a partilha de ficheiros',
  1433: 'a base de dados',
  3306: 'a base de dados',
  3389: 'o ambiente de trabalho remoto',
  5432: 'a base de dados',
  5984: 'a base de dados',
  6379: 'a cache',
  9200: 'a pesquisa',
  27017: 'a base de dados',
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
  if (total < 60) return `${total} segundos`;
  const minutos = Math.round(total / 60);
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** Linha "• …" de um passo, no tom do formato acordado. */
function linha(p: Passo, achado: AchadoLido | undefined): string {
  const ip = texto(p.dados?.ip) ?? achado?.ipOrigem ?? 'o IP do atacante';
  const utilizador = texto(p.dados?.utilizador) ?? achado?.utilizador ?? '?';
  const { numero, texto: portas } = portasDoPasso(p, achado);
  const nome = numero !== undefined ? NOME_PORTA[numero] : undefined;
  const onde = nome && portas ? `${nome} (porta ${portas})` : portas ? `a porta ${portas}` : 'a entrada aberta';
  // [o que foi feito, o que não foi feito]
  const frases: Record<string, [string, string]> = {
    bloquear_ip: [`bloqueei o acesso do atacante (${ip}) ao servidor`, `não bloqueei o acesso do atacante (${ip}) ao servidor`],
    terminar_sessoes: ['terminei a sessão que o atacante tinha aberta', 'não terminei a sessão que o atacante tinha aberta'],
    bloquear_utilizador: [`bloqueei a conta "${utilizador}" que ele usou`, `não bloqueei a conta "${utilizador}" que ele usou`],
    desligar_ssh_senha: ['desliguei a entrada por palavra-passe (agora só com chave)', 'não desliguei a entrada por palavra-passe'],
    fechar_ssh_mundo: ['fechei o acesso remoto ao servidor à Internet (só o vosso IP entra)', 'não fechei o acesso remoto ao servidor à Internet'],
    remover_regra: [`fechei ${onde} à Internet na firewall da Leaseweb`, `não fechei ${onde} à Internet na firewall da Leaseweb`],
    // TODO(David/Enio): não há ação de quarentena na lista fechada (shared/tipos.ts). Quando houver,
    // confirmar o nome da ação e o campo com o número de ficheiros (aqui assume-se `ficheiros`).
    quarentena: [
      `pus de lado ${String(Array.isArray(p.dados?.ficheiros) ? p.dados.ficheiros.length : (p.dados?.ficheiros ?? '?'))} ficheiro(s) que ele deixou`,
      'não pus de lado os ficheiros que ele deixou',
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
  const { texto: portas } = portasDoPasso(p, achado);
  const r: Record<string, string> = {
    bloquear_ip: `Desfazer bloqueio do atacante${ip ? ` (${ip})` : ''}`,
    bloquear_utilizador: 'Desfazer bloqueio da conta',
    desligar_ssh_senha: 'Voltar a aceitar palavra-passe',
    fechar_ssh_mundo: 'Desfazer fecho do acesso remoto',
    remover_regra: portas ? `Desfazer fecho da porta ${portas}` : 'Desfazer fecho da porta',
    quarentena: 'Desfazer quarentena',
  };
  return r[p.acao] ?? `Desfazer ${p.acao}`;
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
      ? `🛡️ Incidente contido — ${hora(horaTitulo ?? new Date().toISOString())}`
      : `⚠️ Incidente por conter — ${hora(horaTitulo ?? new Date().toISOString())}`,
  );
  l.push('');

  // RELATORIO_NOME_SERVIDOR permite o nome amigável na demo; sem ele, fica o alvo real (IP/ID).
  const servidor = process.env.RELATORIO_NOME_SERVIDOR?.trim() || achado?.alvo || '?';
  if (achado?.utilizador && achado.ipOrigem) {
    l.push(`Alguém entrou no servidor ${servidor} como "${achado.utilizador}" vindo de ${achado.ipOrigem}${achado.tentativas ? ',' : '.'}`);
    if (achado.tentativas) l.push(`depois de ${achado.tentativas} tentativas falhadas.`);
  } else if (achado && (achado.tipo === 'porta-exposta' || achado.tipo === 'servico-exposto')) {
    const nome = NOME_PORTA[achado.porta];
    l.push(
      nome
        ? `Há uma porta aberta a qualquer pessoa na Internet no servidor ${servidor}: ${nome} (porta ${achado.porta}).`
        : `Há a porta ${achado.porta} aberta a qualquer pessoa na Internet no servidor ${servidor}.`,
    );
  } else if (achado?.tipo === 'credenciais-por-defeito') {
    l.push(`Encontrei credenciais de fábrica no servidor ${servidor} (porta ${achado.porta}).`);
  } else if (achado?.tipo === 'isco-tocado') {
    l.push(`O servidor ${servidor} recebeu tentativas de entrada.`);
  } else {
    l.push(`Encontrei um problema no servidor ${servidor}${achado ? ` (porta ${achado.porta})` : ''}.`);
  }
  l.push('');

  l.push(segundos !== undefined ? `Em ${duracao(segundos)} fiz, por esta ordem:` : 'Por esta ordem:');
  for (const p of unicos) l.push(linha(p, achado));
  if (!unicos.length) l.push('• nenhum passo registado na auditoria');
  l.push('');

  // "Mais nada foi alterado" só se a auditoria o confirmar: nenhum outro pedido feito além deste incidente e da migração.
  const outros = [...porPedido.entries()].filter(
    ([id, evs]) => !pedidosDoIncidente.includes(id) && evs.some((e) => resultadoDe(e) === 'feito') && !evs.some((e) => e.tipo === 'pedido' && e.quem === 'migrador') && !evs.some((e) => e.acao?.tipo === 'migrar'),
  ).length;
  const final: string[] = [];
  if (migracao) final.push(`A migração terminou às ${hora(migracao)}.`);
  // Decidido (David): quando há outras alterações, dizê-lo com o número, em vez de "Mais nada".
  const mais = outros === 1 ? '1 alteração registada' : `${outros} alterações registadas`;
  final.push(outros ? `Além deste incidente, há ${mais} na auditoria.` : 'Mais nada foi alterado.');
  l.push(final.join(' '));

  const botoes: BotaoDesfazer[] = unicos
    .filter((p) => p.resultado === 'feito' && p.reversivel)
    .map((p) => ({ texto: rotuloDesfazer(p, achado), pedidoId: p.pedidoId }));
  if (botoes.length) l.push('Desfazer qualquer passo: usa os botões abaixo.');

  return { texto: l.join('\n'), botoes, passos: unicos };
}

/** Publica o relatório no grupo "Direção" com um botão Desfazer por passo feito. */
export async function publicarRelatorio(achadoId: string, agente: Agente = 'defesa'): Promise<Relatorio> {
  const r = montarRelatorio(achadoId);
  await telegram.enviarComDesfazer(agente, r.texto, r.botoes);
  return r;
}
