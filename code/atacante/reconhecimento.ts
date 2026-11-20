// Reconhecimento não destrutivo às nossas VMs: portas abertas, serviços expostos,
// credenciais por defeito. Sem exploração, sem escrita, sem força bruta (só 1 tentativa por par conhecido).
import type { Achado } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Portas verificadas por defeito. */
export const PORTAS_ALVO = [22, 80, 443, 5432, 5672, 15672, 4222, 8222, 9000, 9001, 6379] as const;

export interface PortaAberta {
  ip: string;
  porta: number;
  /** Banner ou primeira resposta, truncado. */
  banner?: string;
}

export interface ServicoIdentificado extends PortaAberta {
  servico: 'ssh' | 'http' | 'postgres' | 'rabbitmq' | 'rabbitmq-gestao' | 'nats' | 'minio' | 'redis' | 'desconhecido';
}

/** Par de credenciais por defeito a testar, uma única vez, só em leitura. */
export interface CredencialPorDefeito {
  servico: ServicoIdentificado['servico'];
  utilizador: string;
  /** Valores públicos e conhecidos de fábrica (ex.: guest/guest no RabbitMQ). Nunca segredos nossos. */
  senha: string;
}

export const CREDENCIAIS_POR_DEFEITO: CredencialPorDefeito[] = [
  { servico: 'minio', utilizador: 'minioadmin', senha: 'minioadmin' },
  { servico: 'rabbitmq-gestao', utilizador: 'guest', senha: 'guest' },
  { servico: 'postgres', utilizador: 'postgres', senha: 'postgres' },
];

/** TCP connect com timeout. Chama garantirPermitido() antes de cada ligação. */
export function varrerPortas(ip: string, portas?: readonly number[], timeoutMs?: number): Promise<PortaAberta[]> {
  return naoImplementado('varrerPortas');
}

/** Identifica o serviço por banner/resposta (HTTP GET /, saudação SSH, etc.). */
export function identificarServico(porta: PortaAberta): Promise<ServicoIdentificado> {
  return naoImplementado('identificarServico');
}

/** Uma tentativa por credencial conhecida, só operações de leitura (ex.: GET /api/overview). */
export function testarCredenciaisPorDefeito(servico: ServicoIdentificado): Promise<Achado[]> {
  return naoImplementado('testarCredenciaisPorDefeito');
}

/** Corre tudo para um alvo e devolve achados. Não escreve na auditoria (fá-lo quem chama). */
export function reconhecer(ip: string): Promise<Achado[]> {
  return naoImplementado('reconhecer');
}
