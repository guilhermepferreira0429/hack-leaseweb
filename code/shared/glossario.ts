// Glossário Simples/Técnico: o painel tem um interruptor para o dono não-tech.
// No modo "simples", troca-se o jargão por palavras do dia a dia; no modo "técnico", fica tudo como está.
// É só uma camada de apresentação (texto já medido): não muda nenhum facto, nenhum número.
// Fonte única dos termos para o painel e para a voz dos agentes.

/** Jargão -> palavras simples. Ordenado do mais longo para o mais curto na aplicação, para "RDS PostgreSQL" ganhar a "PostgreSQL". */
export const GLOSSARIO: Record<string, string> = {
  'RDS PostgreSQL': 'AWS managed database',
  'ElastiCache Redis': 'AWS cache',
  'Secrets Manager and Parameter Store': 'AWS secrets store',
  'Secrets Manager': 'AWS secrets store',
  'Parameter Store': 'AWS secrets store',
  'security group': 'firewall rule',
  PostgreSQL: 'database',
  RabbitMQ: 'message queue',
  OpenBao: 'secrets vault',
  Valkey: 'cache',
  MinIO: 'object storage',
  checksum: 'file fingerprint',
  checksums: 'file fingerprints',
  'auth.log': 'login log',
  nmap: 'port scan',
  Terraform: 'infrastructure config',
  SQS: 'AWS message queue',
  S3: 'AWS file storage',
};

// Uma só expressão regular, com os termos ordenados do mais longo para o mais curto (o mais longo ganha).
const TERMOS = Object.keys(GLOSSARIO).sort((a, b) => b.length - a.length);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PADRAO = new RegExp(`(${TERMOS.map(escapar).join('|')})`, 'g');

/** Troca o jargão por palavras simples. Preserva o que não está no glossário. */
export function simplificar(texto: string): string {
  return texto.replace(PADRAO, (t) => GLOSSARIO[t] ?? t);
}

export type ModoTexto = 'simples' | 'tecnico';

/** O que mostrar ao dono conforme o interruptor do painel. 'tecnico' devolve o original. */
export function paraModo(texto: string, modo: ModoTexto): string {
  return modo === 'simples' ? simplificar(texto) : texto;
}
