// Tipos do tradutor AWS (Terraform JSON) -> plano Leaseweb. Só plano: nada aqui chama uma API.

/** Terraform em sintaxe JSON (main.tf.json). Só lemos o que precisamos; o resto passa como desconhecido. */
export type TerraformJson = {
  provider?: Record<string, unknown>;
  variable?: Record<string, { default?: unknown } | undefined>;
  data?: Record<string, Record<string, unknown>>;
  resource?: Record<string, Record<string, unknown>>;
  [outra: string]: unknown;
};

/** Um pedido à API da Leaseweb (publicCloud/v1), tal e qual seria enviado. Não é enviado. */
export type PedidoLeaseweb = {
  metodo: 'POST';
  /** Ids que só existem depois de pedidos anteriores aparecem como {securityGroupId:aws_security_group.web}. */
  caminho: string;
  corpo: Record<string, unknown>;
};

export type ItemCriar = {
  /** Recurso de origem, ex.: aws_instance.web */
  origem: string;
  acao: 'criar-grupo' | 'autorizar-regras' | 'criar-instancia' | 'ligar-grupos';
  descricao: string;
  pedido: PedidoLeaseweb;
  /** O que ainda tem de ser confirmado contra a API real. */
  notas: string[];
  /** cloud-init a usar na instância, já sem as linhas com segredos. */
  cloudInit?: string;
};

export type ItemSubstituir = {
  origem: string;
  servicoAws: string;
  alternativa: string;
  comoSeMove: string;
  /** Nível no catálogo de ferramentas.md. */
  nivel: 'A' | 'B' | 'C';
};

export type ItemSinalizar = {
  origem: string;
  assunto: 'iam' | 'lock-in' | 'ami-custom' | 'egress' | 'regiao' | 'tipo' | 'rede' | 'ssh' | 'admin-ip' | 'desconhecido';
  /** Etiqueta curta para o resumo, ex.: "Lambda miniaturas". */
  titulo: string;
  porque: string;
  oQueFazer: string;
};

export type DestinoPorta = 'so-admin' | 'admin-ip-em-falta' | 'nao-existe';

export type ItemRecusar =
  | {
      tipo: 'porta-aberta';
      origem: string;
      protocolo: string;
      inicio: number;
      fim: number;
      /** A origem que NÃO se copia (0.0.0.0/0 ou ::/0). */
      fonte: string;
      portasSensiveis: number[];
      destino: DestinoPorta;
      porque: string;
    }
  | {
      tipo: 'segredo';
      origem: string;
      onde: 'user_data' | 'tags' | 'atributo';
      /** Nome do segredo (ex.: AWS_SECRET_ACCESS_KEY). O valor nunca entra no plano. */
      nome: string;
      /** Linha dentro do user_data; nas tags e atributos, linha no ficheiro (se o recebemos em texto). */
      linha?: number;
      porque: string;
    };

export type PlanoTraducao = {
  /** Região AWS de origem, se se conseguiu saber. */
  regiaoOrigem?: string;
  regiaoDestino: string;
  criar: ItemCriar[];
  substituir: ItemSubstituir[];
  sinalizar: ItemSinalizar[];
  recusar: ItemRecusar[];
};

export type OpcoesTraducao = {
  /** IP (ou CIDR) do administrador para SSH/RDP. Por omissão lê process.env.ADMIN_IP. */
  adminIp?: string;
};
