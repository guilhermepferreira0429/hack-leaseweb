// corrigir(pedido): executa a Acao de um pedido APROVADO, verifica e audita.
// remover_regra:
//   1. recusa se pedido.estado !== 'aprovado' ou se o tipo não estiver em TIPOS_ACAO
//   2. leaseweb.removerRegra (lê, remove, volta a ler)
//   3. auditoria.registar com antes, depois e inverso { tipo: 'criar_regra', securityGroupId, regra sem id }
//   4. estado 'feito' e telegram.notificar("Fechado e confirmado às HH:MM")
//   nmap antes e depois (verificarDeFora), se o IP da vítima for conhecido e estiver em ALVOS_PERMITIDOS
// migrar: delega no migrador (passo s3).
import { isIP } from 'node:net';
import type { EventoAuditoria, Inverso, Pedido, Regra } from '@mwbe/shared';
import { TIPOS_ACAO, auditoria, carregarConfig, estado, leaseweb, securityGroupsGeridos, telegram } from '@mwbe/shared';
import { PORTAS_SENSIVEIS } from './detetar';
import { type EstadoPorta, estadoPorta } from './verificar-porta';

/** Ajustável nos testes (nmap falso, esperas curtas). */
export const verificacao = { estadoPorta, tentativasDepois: 4, intervaloMs: 3_000 };

/** IPs da vítima que se podem verificar de fora (do grupo e em ALVOS_PERMITIDOS) e a porta a testar. */
async function alvosDeFora(sg: string, regra: Regra): Promise<{ ips: string[]; porta: number }> {
  const permitidos = new Set(carregarConfig([]).alvosPermitidos);
  const ips = ((await leaseweb.ipsPorSecurityGroup())[sg] ?? []).filter((ip) => isIP(ip) !== 0 && permitidos.has(ip));
  const porta = Object.keys(PORTAS_SENSIVEIS).map(Number).find((p) => p >= regra.startPort && p <= regra.endPort) ?? regra.startPort;
  return { ips, porta };
}

/**
 * nmap vista de fora, antes e depois de fechar (docs/demo.md: "open" -> "filtered"). Só a IPs do grupo
 * que também estão em ALVOS_PERMITIDOS; sem isso não faz nada. Nunca lança: é prova, não é o fecho.
 * Depois de fechar tenta algumas vezes, porque a firewall da Leaseweb pode demorar uns segundos a aplicar.
 */
export async function verificarDeFora(pedidoId: string, sg: string, regra: Regra, fase: 'antes' | 'depois'): Promise<void> {
  try {
    const { ips, porta } = await alvosDeFora(sg, regra);
    for (const ip of ips) {
      let resultado: EstadoPorta = 'desconhecido';
      const tentativas = fase === 'depois' ? verificacao.tentativasDepois : 1;
      for (let i = 0; i < tentativas; i++) {
        if (i > 0) await new Promise((ok) => setTimeout(ok, verificacao.intervaloMs));
        resultado = await verificacao.estadoPorta(ip, porta);
        if (fase === 'antes' || resultado !== 'open') break;
      }
      auditoria.registar({ hora: new Date().toISOString(), pedidoId, tipo: 'verificado', quem: 'defesa', depois: { ip, porta, fase, estado: resultado } });
    }
  } catch (erro) {
    console.warn('[defesa] verificação com nmap falhou:', erro instanceof Error ? erro.message : erro);
  }
}

/** Calcula o inverso ANTES de aplicar. */
export function inversoDe(pedido: Pedido): Inverso | undefined {
  const a = pedido.acao;
  if (a.tipo !== 'remover_regra') return undefined;
  const { id: _id, ...semId } = a.regra;
  return { tipo: 'criar_regra', securityGroupId: a.securityGroupId, regra: semId };
}

export const horaCurta = (d = new Date()) =>
  d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });

export type Avisar = (texto: string) => Promise<void>;

/** Avisar o dono nunca pode partir o ciclo: a porta já está fechada e auditada. */
export async function avisarSemFalhar(avisar: Avisar, texto: string): Promise<void> {
  try {
    await avisar(texto);
  } catch (erro) {
    console.warn('[defesa] aviso no Telegram falhou:', erro instanceof Error ? erro.message : erro);
  }
}

/**
 * `avisar`: o canal do dono (por omissão telegram.notificar). O orquestrador passa o da consola no plano B,
 * para o "Fechado e confirmado ... /desfazer <id>" aparecer também em --consola.
 */
export async function corrigir(pedido: Pedido, avisar: Avisar = (t) => telegram.notificar(t)): Promise<void> {
  if (pedido.estado !== 'aprovado') throw new Error(`Pedido ${pedido.id} não está aprovado (estado: ${pedido.estado})`);
  if (!(TIPOS_ACAO as readonly string[]).includes(pedido.acao.tipo)) throw new Error(`Ação fora da lista: ${pedido.acao.tipo}`);

  const acao = pedido.acao;
  if (acao.tipo === 'migrar') {
    // O migrador é do Guilherme; o orquestrador chama-o diretamente. Aqui não se mexe em nada.
    throw new Error('Ação migrar: tratada pelo orquestrador (migrador), não pela defesa');
  }

  const geridos = securityGroupsGeridos();
  if (!geridos.includes(acao.securityGroupId)) {
    throw new Error(`Security group ${acao.securityGroupId} não está em LSW_SG_GERIDOS: a defesa não lhe mexe`);
  }

  await verificarDeFora(pedido.id, acao.securityGroupId, acao.regra, 'antes');
  const inverso = inversoDe(pedido);
  // O inverso fica no disco ANTES de se mexer na infraestrutura: se algo cair a meio, o Desfazer sabe o que repor.
  auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'a-aplicar', quem: 'defesa', antes: acao.regra, inverso });

  // Confirmação de fora: a regra em DELETING e nenhum IP da vítima responde na porta (nmap). Sem IPs, espera pela API.
  const deFora = await alvosDeFora(acao.securityGroupId, acao.regra).catch(() => ({ ips: [] as string[], porta: 0 }));
  const confirmadoDeFora = deFora.ips.length
    ? async () => (await Promise.all(deFora.ips.map((ip) => verificacao.estadoPorta(ip, deFora.porta)))).every((e) => e === 'filtered' || e === 'closed')
    : undefined;

  let antes;
  let confirmacao: 'api' | 'de-fora';
  try {
    ({ antes, confirmacao } = await leaseweb.removerRegra(acao.securityGroupId, acao.regra.id, { confirmadoDeFora }));
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'falhou', quem: 'defesa', depois: msg });
    await avisarSemFalhar(avisar, `Não consegui fechar "${pedido.titulo}": ${msg}`);
    throw erro;
  }

  const depois = await leaseweb.listarRegras(acao.securityGroupId);
  // `confirmacao`: 'de-fora' = o nmap já não chega à porta (a API ainda lista a regra em DELETING); 'api' = a regra saiu da API.
  auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'feito', quem: 'defesa', antes, depois, inverso, confirmacao } as EventoAuditoria);
  if (estado.obterPedido(pedido.id)) estado.mudarEstado(pedido.id, 'feito');
  await avisarSemFalhar(avisar, `Fechado e confirmado às ${horaCurta()}: ${pedido.titulo}. Para voltar atrás: /desfazer ${pedido.id}`);
  await verificarDeFora(pedido.id, acao.securityGroupId, acao.regra, 'depois');
}
