// Reconhecimento não destrutivo com nmap às nossas VMs: portas abertas, serviço, credenciais por defeito.
// Sem exploração, sem escrita, sem força bruta (no máximo 1 tentativa por credencial de fábrica conhecida).
import type { Achado } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Portas verificadas (as sensíveis de docs/arquitetura.md + as da migração). */
export const PORTAS_ALVO = [22, 23, 80, 443, 445, 1433, 3306, 3389, 4222, 5432, 5672, 5984, 6379, 9000, 9001, 9200, 15672, 27017] as const;

export interface PortaNmap {
  ip: string;
  porta: number;
  estado: 'open' | 'closed' | 'filtered';
  servico: string | null;
}

/** Credenciais de fábrica, públicas. Nunca segredos nossos. Corta-se primeiro se faltar tempo. */
export const CREDENCIAIS_POR_DEFEITO = [
  { servico: 'minio', porta: 9000, utilizador: 'minioadmin', senha: 'minioadmin' },
  { servico: 'rabbitmq', porta: 15672, utilizador: 'guest', senha: 'guest' },
] as const;

/** Recusa IPs fora de ALVOS_PERMITIDOS; corre nmap aos restantes e devolve os achados. */
export function reconhecer(alvos: string[]): Promise<Achado[]> {
  return naoImplementado('reconhecer');
}

/** nmap -Pn -sT -sV -p <PORTAS_ALVO> -oX - <ip>  (execFile, sem shell). */
export function correrNmap(ip: string, portas?: readonly number[]): Promise<string> {
  return naoImplementado('correrNmap');
}

/** Lê o XML do nmap. Função pura, testável com uma saída gravada. */
export function lerSaidaNmap(xml: string): PortaNmap[] {
  return naoImplementado('lerSaidaNmap');
}

/** Porta aberta -> Achado tipo 'servico-exposto', origem 'atacante'. */
export function paraAchado(porta: PortaNmap): Achado {
  return naoImplementado('paraAchado');
}

/** Uma tentativa por credencial de fábrica, só leitura. Devolve achados 'credenciais-por-defeito'. */
export function testarCredenciaisPorDefeito(portas: PortaNmap[]): Promise<Achado[]> {
  return naoImplementado('testarCredenciaisPorDefeito');
}
