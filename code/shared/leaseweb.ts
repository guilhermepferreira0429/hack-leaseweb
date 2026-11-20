// Cliente da Leaseweb Public Cloud API v1. Contrato em docs/interfaces.md; notas em docs/leaseweb-api.md.
// Base: https://api.leaseweb.com/publicCloud/v1  Cabeçalho: X-LSW-Auth
// Endpoints que constam da documentação oficial (spec OpenAPI de publiccloud_v1):
//   GET  /securityGroups                                       lista paginada (limit, offset)
//   GET  /securityGroups/{securityGroupId}/firewallRules       { firewallRules: [...] }
//   POST /securityGroups/{securityGroupId}/revokeFirewallRules     { rules: ["<uuid>"] }  -> 202 Accepted (assíncrono)
//   POST /securityGroups/{securityGroupId}/authorizeFirewallRules  { rules: [{ protocol, startPort, endPort, source }] }
//   GET  /instances/{instanceId}/securityGroups
// RISCO: o exemplo de resposta de firewallRules na documentação não mostra `id`,
// mas o revoke pede ids. Confirmar com curl às 09:30.
// Nunca usar attachSecurityGroups/detachSecurityGroups: trocar o grupo substitui as regras todas.
import type { Regra } from './tipos';
import { carregarEnv } from './config';

/** Ajustável nos testes (fetch falso, esperas curtas). Por defeito lê LSW_API_BASE e LSW_API_KEY do ambiente. */
export const opcoes = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  intervaloMs: 2_000,
  limiteMs: 90_000,
  pedidoTimeoutMs: 15_000,
};

function base(): string {
  carregarEnv();
  return (process.env.LSW_API_BASE || 'https://api.leaseweb.com/publicCloud/v1').replace(/\/+$/, '');
}

function chave(): string {
  carregarEnv();
  const k = process.env.LSW_API_KEY;
  if (!k) throw new Error('LSW_API_KEY em falta no .env');
  return k;
}

export class ErroLeaseweb extends Error {
  constructor(
    message: string,
    readonly estado?: number,
  ) {
    super(message);
    this.name = 'ErroLeaseweb';
  }
}

/** Pedido cru à API (scripts de infraestrutura, ex.: defesa/vitima.ts). A defesa usa as funções acima. */
export async function pedido<T>(metodo: 'GET' | 'POST' | 'DELETE' | 'PUT', caminho: string, corpo?: unknown): Promise<T> {
  const res = await opcoes.fetch(`${base()}${caminho}`, {
    method: metodo,
    headers: {
      'X-LSW-Auth': chave(),
      Accept: 'application/json',
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(opcoes.pedidoTimeoutMs),
  });
  const texto = await res.text();
  if (!res.ok) {
    // Nunca incluir a chave na mensagem; o corpo da API é curto e útil para depurar.
    throw new ErroLeaseweb(`${metodo} ${caminho} -> ${res.status} ${texto.slice(0, 300)}`, res.status);
  }
  return (texto ? JSON.parse(texto) : undefined) as T;
}

type RegraApi = {
  id?: string;
  protocol?: string;
  source?: string;
  startPort?: number | null;
  endPort?: number | null;
  state?: string;
};

/** Converte a regra da API para o nosso tipo. Sem id não dá para fazer revoke: falha alto. */
export function normalizarRegra(r: RegraApi): Regra & { estado?: string } {
  if (!r.id) throw new ErroLeaseweb('A API devolveu uma regra sem id: o revoke precisa dele (ver docs/leaseweb-api.md)');
  // Sem portas (protocolo ANY ou "todas as portas"): é a regra mais perigosa, trata-se como 1-65535.
  const semPortas = r.startPort == null && r.endPort == null;
  return {
    id: r.id,
    protocol: String(r.protocol ?? '').toUpperCase(),
    source: String(r.source ?? ''),
    startPort: semPortas ? 1 : Number(r.startPort ?? r.endPort),
    endPort: semPortas ? 65535 : Number(r.endPort ?? r.startPort),
    ...(r.state ? { estado: r.state } : {}),
  };
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function esperarAte<T>(descricao: string, tentar: () => Promise<T | undefined>): Promise<T> {
  const fim = Date.now() + opcoes.limiteMs;
  for (;;) {
    const r = await tentar();
    if (r !== undefined) return r;
    if (Date.now() >= fim) throw new ErroLeaseweb(`Tempo esgotado à espera de: ${descricao}`);
    await esperar(opcoes.intervaloMs);
  }
}

export async function listarSecurityGroups(): Promise<{ id: string; nome: string }[]> {
  const grupos: { id: string; nome: string }[] = [];
  const limite = 50;
  for (let offset = 0; ; offset += limite) {
    const r = await pedido<{ securityGroups?: { id: string; name?: string }[]; _metadata?: { totalCount?: number } }>(
      'GET',
      `/securityGroups?limit=${limite}&offset=${offset}`,
    );
    const pagina = r?.securityGroups ?? [];
    grupos.push(...pagina.map((g) => ({ id: g.id, nome: g.name ?? g.id })));
    const total = r?._metadata?.totalCount ?? grupos.length;
    if (pagina.length < limite || grupos.length >= total) return grupos;
  }
}

type InstanciaApi = { id: string; ips?: { ip?: string; networkType?: string; version?: number }[] };

/**
 * IPs públicos das instâncias de cada security group: { sgId: [ip, ...] }.
 * 1.º LSW_IP_SG no .env ("ip=sg,ip=sg"), que manda sempre; 2.º a API (GET /instances + /instances/{id}/securityGroups).
 * Se a API falhar, fica só o que vem do .env: sem mapa, a defesa não liga achados do atacante a regras (falha fechado).
 */
export async function ipsPorSecurityGroup(): Promise<Record<string, string[]>> {
  carregarEnv();
  const mapa: Record<string, string[]> = {};
  const juntar = (sg: string, ip: string) => {
    mapa[sg] ??= [];
    if (!mapa[sg].includes(ip)) mapa[sg].push(ip);
  };
  for (const par of (process.env.LSW_IP_SG ?? '').split(',')) {
    const [ip, sg] = par.split('=').map((s) => s.trim());
    if (ip && sg) juntar(sg, ip);
  }
  try {
    const r = await pedido<{ instances?: InstanciaApi[] }>('GET', '/instances?limit=50');
    for (const inst of r?.instances ?? []) {
      const ips = (inst.ips ?? []).filter((i) => i.ip && i.networkType !== 'INTERNAL').map((i) => i.ip!);
      if (!ips.length) continue;
      const g = await pedido<{ securityGroups?: { id: string }[] }>('GET', `/instances/${encodeURIComponent(inst.id)}/securityGroups`);
      for (const sg of g?.securityGroups ?? []) for (const ip of ips) juntar(sg.id, ip);
    }
  } catch (erro) {
    console.warn('[leaseweb] não consegui mapear IP -> security group pela API:', erro instanceof Error ? erro.message : erro);
  }
  return mapa;
}

/** Regras com o estado da API (ACTIVE, CREATING, DELETING...). Uso interno e para verificar. */
export async function listarRegrasComEstado(sg: string): Promise<(Regra & { estado?: string })[]> {
  const r = await pedido<{ firewallRules?: RegraApi[] }>('GET', `/securityGroups/${encodeURIComponent(sg)}/firewallRules`);
  return (r?.firewallRules ?? []).map(normalizarRegra);
}

export async function listarRegras(sg: string): Promise<Regra[]> {
  return (await listarRegrasComEstado(sg)).map(({ estado: _e, ...regra }) => regra);
}

/**
 * Lê, remove só esta regra (revoke, 202) e espera pela confirmação. Devolve a regra como estava.
 * Confirmado = a regra desapareceu da API, OU está em DELETING e `confirmadoDeFora()` diz que a porta já não
 * responde de fora. Medido a 20/11: a firewall fecha ~3 s depois do revoke, mas a API lista a regra em
 * DELETING durante ~39 s. Sem `confirmadoDeFora`, espera pela API (mais lento, mas nunca diz "fechado" cedo demais).
 */
export async function removerRegra(
  sg: string,
  regraId: string,
  opcoes: { confirmadoDeFora?: () => Promise<boolean> } = {},
): Promise<{ antes: Regra; confirmacao: 'api' | 'de-fora' }> {
  const atual = (await listarRegras(sg)).find((r) => r.id === regraId);
  if (!atual) throw new ErroLeaseweb(`Regra ${regraId} não existe no security group ${sg}`);
  await pedido('POST', `/securityGroups/${encodeURIComponent(sg)}/revokeFirewallRules`, { rules: [regraId] });
  const confirmacao = await esperarAte(`regra ${regraId} removida`, async () => {
    const r = (await listarRegrasComEstado(sg)).find((x) => x.id === regraId);
    if (!r) return 'api' as const;
    if (r.estado === 'DELETING' && opcoes.confirmadoDeFora && (await opcoes.confirmadoDeFora().catch(() => false))) return 'de-fora' as const;
    return undefined;
  });
  return { antes: atual, confirmacao };
}

const mesmaRegra = (a: Omit<Regra, 'id'>, b: Omit<Regra, 'id'>) =>
  a.protocol.toUpperCase() === b.protocol.toUpperCase() &&
  a.source === b.source &&
  a.startPort === b.startPort &&
  a.endPort === b.endPort;

/** O inverso de removerRegra (authorize). Devolve a regra criada, com o novo id, já ACTIVE. */
export async function criarRegra(sg: string, regra: Omit<Regra, 'id'>): Promise<Regra> {
  const idsAntes = new Set((await listarRegras(sg)).map((r) => r.id));
  await pedido('POST', `/securityGroups/${encodeURIComponent(sg)}/authorizeFirewallRules`, {
    rules: [{ protocol: regra.protocol.toUpperCase(), startPort: regra.startPort, endPort: regra.endPort, source: regra.source }],
  });
  return esperarAte('regra criada e ACTIVE', async () => {
    const nova = (await listarRegrasComEstado(sg)).find((r) => !idsAntes.has(r.id) && mesmaRegra(r, regra));
    if (nova?.estado === 'FAILED') throw new ErroLeaseweb(`A Leaseweb falhou a criar a regra ${nova.id}`);
    if (!nova || (nova.estado && nova.estado !== 'ACTIVE')) return undefined;
    const { estado: _e, ...semEstado } = nova;
    return semEstado;
  });
}
