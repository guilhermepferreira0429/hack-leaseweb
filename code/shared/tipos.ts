// Tipos comuns aos quatro agentes (migrador, atacante, defesa, painel).
// Regra de ouro: a IA só produz texto (Explicacao). Tudo o que muda infraestrutura
// é uma Acao cujo `tipo` pertence à lista fechada TIPOS_ACAO.

/** Protocolos aceites pela API de security groups da Leaseweb. */
export type Protocolo = 'TCP' | 'UDP' | 'ICMP';

/** Estado de uma regra na Leaseweb (firewallRuleState). */
export type EstadoRegra = 'CREATING' | 'ACTIVE' | 'FAILED' | 'DELETING';

/**
 * Regra de entrada num security group da Leaseweb Public Cloud.
 * Os security groups da Leaseweb só têm regras de entrada (não há campo de direção).
 */
export interface Regra {
  /** Id da regra na Leaseweb. Necessário para revokeFirewallRules. */
  id?: string;
  securityGroupId: string;
  protocolo: Protocolo;
  /** null para ICMP. */
  portaInicio: number | null;
  /** null para ICMP. */
  portaFim: number | null;
  icmpType: number | null;
  icmpCode: number | null;
  /** CIDR de origem, ex.: "0.0.0.0/0". */
  origem: string;
  estado?: EstadoRegra;
}

/** Especificação de uma regra sem identidade, usada para a repor (o inverso de remover). */
export type EspecRegra = Omit<Regra, 'id' | 'estado'>;

export type Severidade = 'baixa' | 'media' | 'alta' | 'critica';

/** De onde veio o achado. */
export type FonteAchado = 'atacante' | 'security-group' | 'isco';

export interface Achado {
  id: string;
  fonte: FonteAchado;
  severidade: Severidade;
  /** Título curto e técnico, ex.: "Postgres 5432 aberto a 0.0.0.0/0". */
  titulo: string;
  /** Detalhe técnico (não é mostrado ao humano sem passar pela Explicacao). */
  detalhe: string;
  alvoIp?: string;
  porta?: number;
  servico?: string;
  /** Regra que causa a exposição, se identificada. É o que a defesa pode fechar. */
  regra?: Regra;
  /** Evidência bruta (banner, resposta HTTP, etc.), truncada. */
  evidencia?: string;
  detetadoEm: string;
}

/** Texto gerado pela IA: exatamente 3 frases em português simples. Nunca contém ações. */
export interface Explicacao {
  achadoId: string;
  frases: [string, string, string];
  modelo: string;
  geradaEm: string;
}

/** Lista fechada de ações que o sistema sabe executar. Nada fora daqui corre. */
export const TIPOS_ACAO = ['remover-regra', 'repor-regra'] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

export type EstadoAcao =
  | 'proposta'
  | 'aguarda-aprovacao'
  | 'aprovada'
  | 'recusada'
  | 'aplicada'
  | 'confirmada'
  | 'falhou'
  | 'desfeita';

/** Ação sobre a infraestrutura. Cada ação traz o seu inverso antes de ser aplicada. */
export interface Acao {
  id: string;
  tipo: TipoAcao;
  achadoId: string;
  securityGroupId: string;
  /** Para 'remover-regra': a regra com id. Para 'repor-regra': a especificação a repor. */
  regra: Regra | EspecRegra;
  /** Ação que desfaz esta. Calculada antes de aplicar e guardada na auditoria. */
  inverso: { tipo: TipoAcao; regra: EspecRegra };
  estado: EstadoAcao;
  explicacao?: Explicacao;
  criadaEm: string;
}

/** Quem originou o evento. */
export type Ator = 'migrador' | 'atacante' | 'defesa' | 'humano' | 'painel';

/** Fases mostradas na linha do tempo do painel. */
export type Fase = 'migrar' | 'atacar' | 'aprovar' | 'fechar';

export type TipoEvento =
  | 'migracao-inicio'
  | 'migracao-passo'
  | 'migracao-fim'
  | 'teste-resultado'
  | 'reconhecimento-inicio'
  | 'achado'
  | 'isco-tocado'
  | 'explicacao'
  | 'pedido-aprovacao'
  | 'aprovado'
  | 'recusado'
  | 'aplicado'
  | 'confirmado'
  | 'desfeito'
  | 'alvo-recusado'
  | 'erro';

/** Uma linha do ficheiro auditoria.jsonl. Append-only. */
export interface EventoAuditoria {
  id: string;
  ts: string;
  tipo: TipoEvento;
  fase: Fase;
  ator: Ator;
  /** Resumo legível para a linha do tempo. */
  resumo: string;
  achado?: Achado;
  acao?: Acao;
  /** Inverso da ação aplicada, guardado sempre que se muda a infraestrutura. */
  inverso?: Acao['inverso'];
  /** Quem aprovou (número WhatsApp ou chat Telegram), quando aplicável. */
  aprovador?: string;
  dados?: Record<string, unknown>;
}

/** Canal usado para pedir aprovação humana. */
export type CanalAprovacao = 'whatsapp' | 'telegram';

/** Resposta do humano, vinda de um botão. */
export interface RespostaHumana {
  canal: CanalAprovacao;
  decisao: 'aprovar' | 'recusar' | 'desfazer';
  acaoId: string;
  /** Identificador de quem respondeu, validado contra a lista de aprovadores. */
  remetente: string;
  recebidaEm: string;
}
