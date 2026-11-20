// Cliente mínimo da Leaseweb Public Cloud API v1.
// Base: https://api.leaseweb.com/publicCloud/v1  Cabeçalho: X-LSW-Auth
// Endpoints confirmados na documentação oficial (developer.leaseweb.com, publiccloud_v1):
//   GET  /instances
//   GET  /instances/{instanceId}                       -> ips[].ip, ips[].type ("NORMAL_IP"), ips[].primary
//   GET  /instances/{instanceId}/securityGroups
//   GET  /securityGroups
//   GET  /securityGroups/{securityGroupId}
//   GET  /securityGroups/{securityGroupId}/firewallRules
//   POST /securityGroups/{securityGroupId}/authorizeFirewallRules   body { rules: [regra] }
//   POST /securityGroups/{securityGroupId}/revokeFirewallRules      body { rules: [ids] }  -> 202 (assíncrono)
// RISCO: o exemplo de resposta de firewallRules na documentação não mostra `id`,
// mas o revoke pede ids. Validar contra a API real antes das 11:30.
import type { Protocolo, EstadoRegra, Regra, EspecRegra } from './tipos';
import { naoImplementado } from './stub';

/** Forma da regra tal como a API devolve (securityGroupFirewallRuleResponse). */
export interface RegraLsw {
  id?: string;
  protocol: Protocolo;
  startPort: number | null;
  endPort: number | null;
  icmpType: number | null;
  icmpCode: number | null;
  source: string;
  state: EstadoRegra;
}

/** Corpo de cada regra em authorizeFirewallRules. */
export interface RegraAutorizarLsw {
  protocol: Protocolo;
  startPort?: number | null;
  endPort?: number | null;
  icmpType?: number | null;
  icmpCode?: number | null;
  source: string;
}

export interface SecurityGroupLsw {
  id: string;
  name: string;
  default: boolean;
  state: 'CREATING' | 'ACTIVE' | 'FAILED' | 'SYNCING';
}

export interface IpLsw {
  ip: string;
  version: 4 | 6;
  type: string;
  primary: boolean;
}

export interface InstanciaLsw {
  id: string;
  reference?: string;
  state: string;
  ips: IpLsw[];
}

export interface Paginado<T> {
  _metadata: { totalCount: number; limit: number; offset: number };
  itens: T[];
}

export interface OpcoesClienteLeaseweb {
  apiBase: string;
  apiKey: string;
  /** Allowlist: só estes security groups podem ser alterados. */
  securityGroupsGeridos: string[];
}

export class ClienteLeaseweb {
  constructor(private readonly opcoes: OpcoesClienteLeaseweb) {}

  // ---------- leitura ----------

  listarInstancias(): Promise<InstanciaLsw[]> {
    return naoImplementado('ClienteLeaseweb.listarInstancias');
  }

  obterInstancia(instanceId: string): Promise<InstanciaLsw> {
    return naoImplementado('ClienteLeaseweb.obterInstancia');
  }

  listarSecurityGroupsDaInstancia(instanceId: string): Promise<SecurityGroupLsw[]> {
    return naoImplementado('ClienteLeaseweb.listarSecurityGroupsDaInstancia');
  }

  listarSecurityGroups(): Promise<SecurityGroupLsw[]> {
    return naoImplementado('ClienteLeaseweb.listarSecurityGroups');
  }

  /** Lê todas as regras de um security group (percorre a paginação limit/offset). */
  listarRegras(securityGroupId: string): Promise<Regra[]> {
    return naoImplementado('ClienteLeaseweb.listarRegras');
  }

  // ---------- escrita (só chamada a partir de defesa/corrigir.ts e defesa/desfazer.ts) ----------

  /** Remove UMA regra. Recusa se o security group não estiver em securityGroupsGeridos. */
  revogarRegra(securityGroupId: string, regraId: string): Promise<void> {
    return naoImplementado('ClienteLeaseweb.revogarRegra');
  }

  /** Repõe UMA regra (usado pelo Desfazer). Mesma allowlist. */
  autorizarRegra(securityGroupId: string, regra: EspecRegra): Promise<void> {
    return naoImplementado('ClienteLeaseweb.autorizarRegra');
  }

  // ---------- internos ----------

  /** fetch com X-LSW-Auth, JSON e erros com correlationId. */
  private pedir<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
    return naoImplementado('ClienteLeaseweb.pedir');
  }

  /** Lança erro se o security group não for gerido por nós. */
  private garantirGerido(securityGroupId: string): void {
    naoImplementado('ClienteLeaseweb.garantirGerido');
  }
}

/** Conversões entre a forma da API e a forma interna. */
export function deRegraLsw(securityGroupId: string, r: RegraLsw): Regra {
  return naoImplementado('deRegraLsw');
}

export function paraRegraAutorizarLsw(r: EspecRegra): RegraAutorizarLsw {
  return naoImplementado('paraRegraAutorizarLsw');
}
