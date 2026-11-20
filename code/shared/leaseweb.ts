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
import { naoImplementado } from './stub';

export function listarSecurityGroups(): Promise<{ id: string; nome: string }[]> {
  return naoImplementado('listarSecurityGroups');
}

export function listarRegras(sg: string): Promise<Regra[]> {
  return naoImplementado('listarRegras');
}

/** Lê, remove só esta regra (revoke, 202) e volta a ler até ela desaparecer. Devolve a regra como estava. */
export function removerRegra(sg: string, regraId: string): Promise<{ antes: Regra }> {
  return naoImplementado('removerRegra');
}

/** O inverso de removerRegra (authorize). Devolve a regra criada, com o novo id. */
export function criarRegra(sg: string, regra: Omit<Regra, 'id'>): Promise<Regra> {
  return naoImplementado('criarRegra');
}
