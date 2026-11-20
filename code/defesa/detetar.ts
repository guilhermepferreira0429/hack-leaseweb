// detetar(): regras com source 0.0.0.0/0 ou ::/0 nos security groups da conta (origem 'api').
// Só olha para os grupos em LSW_SG_GERIDOS (o da vítima): o isco tem 22 aberto de propósito e o cérebro precisa de SSH.
// Os achados do atacante chegam pelo orquestrador e juntam-se aqui com correlacionar().
import type { Achado, Regra } from '@mwbe/shared';
import { leaseweb, securityGroupsGeridos } from '@mwbe/shared';

/** Severidade alta (docs/arquitetura.md). Qualquer outra porta aberta a toda a internet: média. */
export const PORTAS_SENSIVEIS: Record<number, string> = {
  22: 'SSH',
  23: 'Telnet',
  445: 'SMB',
  1433: 'SQL Server',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5984: 'CouchDB',
  6379: 'Redis',
  9200: 'Elasticsearch',
  27017: 'MongoDB',
};

export const ORIGENS_MUNDO = ['0.0.0.0/0', '::/0'] as const;

const abertaAoMundo = (source: string) => (ORIGENS_MUNDO as readonly string[]).includes(source.trim());

/** Porta sensível dentro do intervalo da regra (a primeira), senão a porta inicial. */
function portaRepresentativa(regra: Regra): number {
  const sensivel = Object.keys(PORTAS_SENSIVEIS)
    .map(Number)
    .find((p) => p >= regra.startPort && p <= regra.endPort);
  return sensivel ?? regra.startPort;
}

const cobre = (regra: Regra, porta: number) => porta >= regra.startPort && porta <= regra.endPort;

/** Função pura: a regra está aberta ao mundo? Se sim, devolve o achado (tipo 'porta-exposta'). */
export function avaliarRegra(sg: string, regra: Regra): Achado | undefined {
  if (!abertaAoMundo(regra.source)) return undefined;
  const protocolo = regra.protocol.toUpperCase();
  if (protocolo === 'ICMP') return undefined; // ping aberto não é uma janela aberta
  const porta = portaRepresentativa(regra);
  const servico = PORTAS_SENSIVEIS[porta] ?? null;
  const intervalo = regra.startPort === regra.endPort ? `${regra.startPort}` : `${regra.startPort}-${regra.endPort}`;
  return {
    id: `api-${sg}-${regra.id}`,
    tipo: 'porta-exposta',
    origem: 'api',
    alvo: sg,
    securityGroupId: sg,
    regra,
    porta,
    servico,
    severidade: servico ? 'alta' : 'media',
    detalhe: `${protocolo} ${intervalo} aberto a ${regra.source} no security group ${sg}`,
  };
}

/** IPs públicos de cada security group gerido, da última chamada a detetar(). Usado por correlacionar(). */
let ipsDoSg: Record<string, string[]> = {};

export async function detetar(): Promise<Achado[]> {
  const geridos = securityGroupsGeridos();
  // Falha alto: com a lista vazia não se olhou para nada, e "não encontrei nada" seria mentira.
  if (geridos.length === 0) throw new Error('LSW_SG_GERIDOS vazio: não verifiquei nenhum security group');
  ipsDoSg = await leaseweb.ipsPorSecurityGroup();
  const achados: Achado[] = [];
  for (const sg of geridos) {
    const ip = ipsDoSg[sg]?.[0];
    for (const regra of await leaseweb.listarRegras(sg)) {
      const a = avaliarRegra(sg, regra);
      // Com o IP conhecido, o alvo é o IP (o que o atacante e o nmap veem); senão fica o id do grupo.
      if (a) achados.push(ip ? { ...a, alvo: ip } : a);
    }
  }
  // Mais graves primeiro: é por aí que a demo começa.
  return achados.sort((a, b) => (a.severidade === b.severidade ? a.porta - b.porta : a.severidade === 'alta' ? -1 : 1));
}

/**
 * Liga os achados do atacante (porta aberta vista de fora) à regra que a permite e remove duplicados.
 * Só liga quando o IP do atacante pertence ao security group da regra (mapa de detetar() ou alvo igual).
 * Sem essa prova não liga: o achado do atacante fica só como aviso. Nunca se fecha a regra de outra máquina
 * (ex.: o isco tem 22 aberto de propósito; não pode virar um pedido para fechar o SSH da vítima).
 * `mapa` (sg -> IPs) é opcional; por omissão usa o da última chamada a detetar().
 */
export function correlacionar(daApi: Achado[], doAtacante: Achado[], mapa: Record<string, string[]> = ipsDoSg): Achado[] {
  const usados = new Set<string>();
  const resultado: Achado[] = [];
  const vistos = new Set<string>();
  const doMesmoAlvo = (api: Achado, at: Achado) =>
    api.alvo === at.alvo || (!!api.securityGroupId && (mapa[api.securityGroupId] ?? []).includes(at.alvo));

  for (const at of doAtacante) {
    const chave = `${at.alvo}:${at.porta}:${at.tipo}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (at.regra && at.securityGroupId) {
      resultado.push(at);
      continue;
    }
    const par = daApi.find((a) => a.regra && cobre(a.regra, at.porta) && doMesmoAlvo(a, at));
    if (!par) {
      resultado.push(at);
      continue;
    }
    usados.add(par.id);
    resultado.push({
      ...at,
      securityGroupId: par.securityGroupId,
      regra: par.regra,
      severidade: at.severidade === 'alta' || par.severidade === 'alta' ? 'alta' : 'media',
      servico: at.servico ?? par.servico,
      detalhe: `${at.detalhe} | permitido por: ${par.detalhe}`,
    });
  }

  for (const a of daApi) if (!usados.has(a.id)) resultado.push(a);
  return resultado;
}
