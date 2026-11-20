# Interfaces (fixas; mudar só com aviso no grupo)

```ts
// shared/tipos.ts
export type Regra = { id: string; protocol: string; source: string; startPort: number; endPort: number };

// NOVO (avisar o grupo): `tipo` escolhe o texto fixo quando o LLM falha.
export type TipoAchado = 'porta-exposta' | 'servico-exposto' | 'credenciais-por-defeito' | 'isco-tocado';

export type Achado = {
  id: string;
  tipo: TipoAchado;
  origem: 'api' | 'atacante';
  alvo: string;                 // IP ou instanceId
  securityGroupId?: string;
  regra?: Regra;
  porta: number;
  servico: string | null;
  severidade: 'alta' | 'media';
  detalhe: string;              // texto técnico curto (para o painel, não para o dono)
};

export type Acao =
  | { tipo: 'remover_regra'; securityGroupId: string; regra: Regra }
  | { tipo: 'migrar'; passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' }  // 20/11 ~11:20: + segredos, cache
  | { tipo: 'aprovar_pr'; repo: string; numero: number };  // 20/11 ~12:40: merge do PR do migrador de código (repo da app). Inverso: { tipo: 'reverter_pr', repo, numero, commit } = um PR que reverte

export type Pedido = { id: string; titulo: string; texto: string; acao: Acao; estado: 'pendente' | 'aprovado' | 'ignorado' | 'feito' | 'desfeito' };

export type EventoAuditoria = {
  hora: string; pedidoId: string; tipo: string; quem?: string;
  antes?: unknown; depois?: unknown; inverso?: Acao | { tipo: 'criar_regra'; securityGroupId: string; regra: Omit<Regra, 'id'> };
};
```

```ts
// shared/leaseweb.ts
listarSecurityGroups(): Promise<{ id: string; nome: string }[]>
listarRegras(sg: string): Promise<Regra[]>
removerRegra(sg: string, regraId: string): Promise<{ antes: Regra }>   // lê, remove, volta a ler
criarRegra(sg: string, regra: Omit<Regra, 'id'>): Promise<Regra>      // o inverso
```

```ts
// shared/llm.ts
explicar(achado: Achado): Promise<string>   // 3 frases, timeout 20 s, recurso texto fixo por achado.tipo
// fornecedores: LLM_* e, se existir, LLM_*_2 como reserva (usa o primeiro que responder)
```

```ts
// shared/bus.ts  (conversa entre agentes; não passa pelo Telegram)
type Agente = 'chefe' | 'migrador' | 'atacante' | 'defesa';
type Mensagem = { de: Agente; para: Agente | 'dono' | 'todos'; texto: string; pedido?: Pedido };
enviar(m: Mensagem): void            // entrega internamente e publica no grupo pelo bot de 'de'
aoReceber(a: Agente, cb: (m: Mensagem) => void): void
```

```ts
// shared/telegram.ts  (long polling, sem webhook)
falar(agente: Agente, texto: string): Promise<void>  // publica no grupo com o bot desse agente
pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void>  // botões "Aprovar" / "Ignorar"
aoResponder(cb: (pedidoId: string, decisao: 'aprovar' | 'ignorar', quem: string) => void): void
aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void  // privado ou com menção
notificar(texto: string): Promise<void>
// comandos: /estado, /desfazer <pedidoId>
```

```ts
// atacante/reconhecimento.ts
reconhecer(alvos: string[]): Promise<Achado[]>   // recusa IPs fora de ALVOS_PERMITIDOS
```

```ts
// defesa/   (parâmetros opcionais acrescentados a 20/11; as chamadas antigas continuam válidas)
detetar(): Promise<Achado[]>                 // regras com source 0.0.0.0/0 ou ::/0; lança se LSW_SG_GERIDOS estiver vazio
correlacionar(daApi: Achado[], doAtacante: Achado[], mapa?: Record<string, string[]>): Achado[]  // mapa: sg -> IPs
tratar(achado: Achado, pedirAprovacao?: (agente, pedido) => Promise<void>): Promise<Pedido>  // explica e pede aprovação
corrigir(pedido: Pedido, avisar?: (texto: string) => Promise<void>): Promise<void>  // executa a Acao, verifica, audita
desfazer(pedidoId: string, avisar?: (texto: string) => Promise<void>): Promise<void>  // aplica o inverso guardado
// pedirAprovacao/avisar: por omissão o Telegram; o orquestrador passa o canal (Telegram ou --consola)
```

```ts
// migrador/
analisar(dirApp: string): Promise<{ servicos: ('s3' | 'postgres' | 'fila' | 'segredos' | 'cache')[]; plano: string }>  // por esta ordem
migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }>
migrarPostgres(): Promise<{ tabelas: number; linhas: number; checksumsOk: boolean }>  // nível B, prova por tabela
migrarFila(): Promise<{ mensagens: number; iguais: boolean }>  // nível B, SQS -> RabbitMQ: confirma e só depois apaga no SQS
migrarSegredos(): Promise<{ segredos: number; iguais: boolean }>  // nível B, Secrets Manager + SSM -> OpenBao; nunca um valor em log (hack-leaseweb-1e)
migrarCache(): Promise<{ chaves: number; iguais: boolean }>  // nível B, ElastiCache Redis -> Valkey; prova por chave, tipo e valor (agente 4)
aprovarPR(repo, numero, { token? }): Promise<{ commit? }>  // merge (squash) do PR do migrador de código, só depois do botão "Aprovar PR"
reverterPR(repo, numero, commit, { token? }): Promise<{ url?, ramo }>  // inverso: abre um PR com o revert; nunca push para main
verificar(): Promise<{ antes: boolean; depois: boolean }>   // mesmos testes nos dois lados

// migrador/codigo.ts  (migrador de código; entrega sempre um PR)
encontrarUsosAws(dirApp: string): Promise<{ ficheiro: string; linha: number; servico: 's3' | 'postgres' | 'fila' | 'outro'; trecho: string }[]>
proporAlteracao(usos: ReturnType<typeof encontrarUsosAws>): Promise<{ ficheiros: string[]; diff: string }>   // regras validam que só mudam as linhas esperadas
abrirPR(alteracao: { ficheiros: string[]; diff: string }, motivo: string): Promise<{ url: string; numero: number }>  // nunca push direto para main
```

```ts
// migrador/tradutor/   (só plano, não chama APIs)
traduzir(tf: string | TerraformJson, opcoes?: { adminIp?: string }): PlanoTraducao  // criar, substituir, sinalizar, recusar
resumoPlano(plano: PlanoTraducao): string                      // texto curto para o Telegram
decidirDestino(entrada: EntradaDecisor): Decisao[]             // self-hosted ou gerido europeu (docs/decisor-destino.md)
mensagemDestino(decisoes: Decisao[], vm: CapacidadeVm): string
```

```ts
// shared/estado.ts   (pedidos em memória do processo; a auditoria é o registo permanente)
guardarPedido(p: Pedido): void
obterPedido(id: string): Pedido | undefined
mudarEstado(id: string, e: EstadoPedido): Pedido
listarPedidos(): Pedido[]
```

```ts
// chefe/   (só números medidos, sem IA)
resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string
estadoAtual(pedidos: Pedido[]): string                          // resposta ao /estado
relogioExposicao(eventos, agora?): { inicio; fim?; segundos; aindaExposta } | undefined  // do último 'infra-no-ar' ao primeiro fecho
certificado(eventos, pedidos, localDados?, agora?): string      // certificado de migração (LOCAL_DADOS)
```

```ts
// orquestrador.ts   (criarOrquestrador(deps, opcoes); index.ts liga os módulos reais)
// Migração: UM só "Aprovar plano" (o pedido do 1.º passo); os outros passos nascem aprovados por ele
// ('pedido' + 'aprovado' com depois.pelo = id do plano). Cada passo tem o seu 'feito'/'erro' com a prova;
// verificar() corre uma só vez, no fim, e os testes entram na prova de cada passo.
// Dependências opcionais (sem elas o passo não acontece): migrador.migrarPostgres, migrarFila, migrarSegredos,
// migrarCache, migrador.planoInfra, migrador.planoDestino, chefe.certificado, relatorio.publicar.
// Eventos que o orquestrador escreve na auditoria: 'pedido', 'aprovado', 'ignorado', 'sem-resposta', 'feito',
// 'erro' (depois.fase), 'reconhecimento' (depois.portas), 'infra-no-ar', 'migracao-plano-infra', 'migracao-plano-destino'.
// Opções: --sem-migrador, --sem-atacante, --sem-fila, --consola, --uma-vez; ESPERA_DECISAO_MS (10 min).
```

```ts
// shared/auditoria.ts
registar(e: EventoAuditoria): void   // uma linha por evento em auditoria.jsonl
ler(): EventoAuditoria[]
```
