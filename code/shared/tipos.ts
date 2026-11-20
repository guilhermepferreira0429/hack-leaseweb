// Tipos comuns. Contrato fixo em docs/interfaces.md: mudar só com aviso no grupo.

/** Regra de entrada de um security group da Leaseweb (campos da API). */
export type Regra = { id: string; protocol: string; source: string; startPort: number; endPort: number };

/** Natureza do achado. Define o texto fixo usado quando o LLM falha (shared/llm.ts). */
export const TIPOS_ACHADO = ['porta-exposta', 'servico-exposto', 'credenciais-por-defeito', 'isco-tocado'] as const;
export type TipoAchado = (typeof TIPOS_ACHADO)[number];

export type Achado = {
  id: string;
  tipo: TipoAchado;
  origem: 'api' | 'atacante';
  alvo: string; // IP ou instanceId
  securityGroupId?: string;
  regra?: Regra;
  porta: number;
  servico: string | null;
  severidade: 'alta' | 'media';
  detalhe: string; // texto técnico curto (para o painel, não para o dono)
};

/** Lista fechada de ações. A IA nunca escolhe a ação: só escreve o texto do Pedido. */
export type Acao =
  | { tipo: 'remover_regra'; securityGroupId: string; regra: Regra }
  | { tipo: 'migrar'; passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' };

export const TIPOS_ACAO = ['remover_regra', 'migrar'] as const satisfies readonly Acao['tipo'][];

/** Inverso de remover_regra: voltar a criar a mesma regra. */
export type Inverso = Acao | { tipo: 'criar_regra'; securityGroupId: string; regra: Omit<Regra, 'id'> };

export type EstadoPedido = 'pendente' | 'aprovado' | 'ignorado' | 'feito' | 'desfeito';

export type Pedido = { id: string; titulo: string; texto: string; acao: Acao; estado: EstadoPedido };

export type EventoAuditoria = {
  hora: string;
  pedidoId: string;
  tipo: string;
  quem?: string;
  antes?: unknown;
  depois?: unknown;
  inverso?: Inverso;
};

export type Decisao = 'aprovar' | 'ignorar';
