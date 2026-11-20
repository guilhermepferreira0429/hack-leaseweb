// Modo noite (docs/ideias-wow.md n.º 4, Enio): o dono não respondeu em MODO_NOITE_MINUTOS a uma falha CRÍTICA.
// Medida temporária e reversível, sem aprovação, só com ações da lista fechada:
//   1. authorize: a mesma porta só para os IPs conhecidos (MODO_NOITE_IPS) -> quem precisa continua a entrar
//   2. revoke: a regra aberta a toda a internet (o mesmo remover_regra de sempre)
// O inverso é o de sempre (criar_regra da regra aberta); o desfazer() também tira as regras temporárias do passo 1.
// Nada acontece se MODO_NOITE_MINUTOS ou MODO_NOITE_IPS estiverem vazios (falha fechado).
// Quem chama: o orquestrador, quando o tempo à espera do dono acaba (ver comLimite em code/orquestrador.ts).
import type { Pedido, Regra } from '@mwbe/shared';
import { auditoria, carregarEnv, estado, leaseweb, securityGroupsGeridos, telegram } from '@mwbe/shared';
import { type Avisar, avisarSemFalhar, horaCurta, inversoDe } from './corrigir';
import { ORIGENS_MUNDO, PORTAS_SENSIVEIS } from './detetar';

export function configModoNoite(): { minutos: number; ips: string[] } | undefined {
  carregarEnv();
  const minutos = Number(process.env.MODO_NOITE_MINUTOS);
  const ips = (process.env.MODO_NOITE_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes('/') ? s : `${s}/32`));
  // Um IP conhecido nunca pode ser "o mundo": seria abrir em vez de fechar.
  if (!(minutos > 0) || ips.length === 0 || ips.some((ip) => (ORIGENS_MUNDO as readonly string[]).includes(ip))) return undefined;
  return { minutos, ips };
}

/** Crítica = porta sensível (severidade alta) aberta a toda a internet. Só estas entram no modo noite. */
export function eCritica(regra: Regra): boolean {
  if (!(ORIGENS_MUNDO as readonly string[]).includes(regra.source)) return false;
  return Object.keys(PORTAS_SENSIVEIS).map(Number).some((p) => p >= regra.startPort && p <= regra.endPort);
}

/**
 * Aplica a medida temporária a um pedido ainda pendente. Devolve true se aplicou.
 * Não lança por falta de configuração ou por o pedido não ser elegível: só devolve false.
 */
export async function modoNoite(pedido: Pedido, avisar: Avisar = (t) => telegram.notificar(t)): Promise<boolean> {
  const cfg = configModoNoite();
  if (!cfg) return false;
  const atual = estado.obterPedido(pedido.id) ?? pedido;
  if (atual.estado !== 'pendente' || atual.acao.tipo !== 'remover_regra') return false;
  const { securityGroupId: sg, regra } = atual.acao;
  if (!securityGroupsGeridos().includes(sg) || !eCritica(regra)) return false;

  const hora = () => new Date().toISOString();
  // Tira o pedido de 'pendente' ANTES de mexer: um Aprovar que chegue durante o modo noite é ignorado
  // pelo orquestrador (só decide pedidos pendentes), em vez de correr um segundo fecho em paralelo.
  estado.mudarEstado(atual.id, 'aprovado');
  auditoria.registar({ hora: hora(), pedidoId: atual.id, tipo: 'aprovado', quem: 'modo-noite' });
  const inverso = inversoDe(atual);
  auditoria.registar({ hora: hora(), pedidoId: atual.id, tipo: 'a-aplicar', quem: 'modo-noite', antes: regra, inverso });

  // 1. Primeiro deixar entrar quem é conhecido (a ordem inversa podia deixar a equipa fora).
  const temporarias: Regra[] = [];
  try {
    for (const source of cfg.ips) {
      const nova = await leaseweb.criarRegra(sg, { protocol: regra.protocol, startPort: regra.startPort, endPort: regra.endPort, source });
      temporarias.push(nova);
      auditoria.registar({ hora: hora(), pedidoId: atual.id, tipo: 'modo-noite-permitir', quem: 'modo-noite', depois: nova });
    }
    // 2. Depois fechar ao mundo.
    const { antes } = await leaseweb.removerRegra(sg, regra.id);
    const depois = await leaseweb.listarRegras(sg);
    auditoria.registar({ hora: hora(), pedidoId: atual.id, tipo: 'feito', quem: 'modo-noite', antes, depois, inverso });
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    auditoria.registar({ hora: hora(), pedidoId: atual.id, tipo: 'falhou', quem: 'modo-noite', depois: msg });
    // Volta a ficar nas mãos do dono. As regras temporárias já criadas ficam na auditoria (modo-noite-permitir).
    estado.mudarEstado(atual.id, 'pendente');
    await avisarSemFalhar(avisar, `Night mode: could not apply the temporary measure to "${atual.titulo}": ${msg}`);
    return false;
  }

  estado.mudarEstado(atual.id, 'feito');
  const porta = regra.startPort === regra.endPort ? `${regra.startPort}` : `${regra.startPort}-${regra.endPort}`;
  await avisarSemFalhar(
    avisar,
    `Night mode at ${horaCurta()}: no answer in ${cfg.minutos} min to a critical finding (${atual.titulo}). ` +
      `I left port ${porta} open only to ${cfg.ips.join(', ')} and closed it to the rest of the internet. ` +
      `This is temporary: /desfazer ${atual.id} puts everything back as it was.`,
  );
  return true;
}
