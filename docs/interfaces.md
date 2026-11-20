# Interfaces (fixed; change only after telling the team)

Identifiers are in Portuguese, as in the code.

```ts
// shared/tipos.ts
export type Regra = { id: string; protocol: string; source: string; startPort: number; endPort: number };

// NEW (tell the team): `tipo` picks the fixed text when the LLM fails.
export type TipoAchado = 'porta-exposta' | 'servico-exposto' | 'credenciais-por-defeito' | 'isco-tocado';

export type Achado = {
  id: string;
  tipo: TipoAchado;
  origem: 'api' | 'atacante';
  alvo: string;                 // IP or instanceId
  securityGroupId?: string;
  regra?: Regra;
  porta: number;
  servico: string | null;
  severidade: 'alta' | 'media';
  detalhe: string;              // short technical text (for the dashboard, not for the owner)
};

export type Acao =
  | { tipo: 'remover_regra'; securityGroupId: string; regra: Regra }
  | { tipo: 'migrar'; passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' }  // 20/11 ~11:20: + segredos, cache
  | { tipo: 'aprovar_pr'; repo: string; numero: number };  // 20/11 ~12:40: merge of the code migrator's PR (app repo). Inverse: { tipo: 'reverter_pr', repo, numero, commit } = a PR that reverts it

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
removerRegra(sg: string, regraId: string): Promise<{ antes: Regra }>   // reads, removes, reads again
criarRegra(sg: string, regra: Omit<Regra, 'id'>): Promise<Regra>      // the inverse
```

```ts
// shared/llm.ts
explicar(achado: Achado): Promise<string>   // 3 sentences, 20 s timeout, fixed fallback text per achado.tipo
// providers: LLM_* and, if set, LLM_*_2 as a backup (uses the first one that answers)
```

```ts
// shared/bus.ts  (conversation between agents; does not go through Telegram)
type Agente = 'chefe' | 'migrador' | 'atacante' | 'defesa';
type Mensagem = { de: Agente; para: Agente | 'dono' | 'todos'; texto: string; pedido?: Pedido };
enviar(m: Mensagem): void            // delivers internally and posts in the group with the bot of 'de'
aoReceber(a: Agente, cb: (m: Mensagem) => void): void
```

```ts
// shared/telegram.ts  (long polling, no webhook)
falar(agente: Agente, texto: string): Promise<void>  // posts in the group with that agent's bot
pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void>  // buttons per action (shared/mensagens.ts): "Approve plan" / "Close" / "Approve PR", and "Ignore"
aoResponder(cb: (pedidoId: string, decisao: 'aprovar' | 'ignorar', quem: string) => void): void
aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void  // private chat or with a mention
notificar(texto: string): Promise<void>
// commands (English; the old Portuguese ones kept as aliases): /status, /undo <pedidoId>, /attack
```

```ts
// atacante/reconhecimento.ts
reconhecer(alvos: string[]): Promise<Achado[]>   // refuses IPs outside ALVOS_PERMITIDOS
```

```ts
// defesa/   (optional parameters added on 20/11; the old calls are still valid)
detetar(): Promise<Achado[]>                 // rules with source 0.0.0.0/0 or ::/0; throws if LSW_SG_GERIDOS is empty
correlacionar(daApi: Achado[], doAtacante: Achado[], mapa?: Record<string, string[]>): Achado[]  // mapa: sg -> IPs
tratar(achado: Achado, pedirAprovacao?: (agente, pedido) => Promise<void>): Promise<Pedido>  // explains and asks for approval
corrigir(pedido: Pedido, avisar?: (texto: string) => Promise<void>): Promise<void>  // runs the Acao, verifies, audits
desfazer(pedidoId: string, avisar?: (texto: string) => Promise<void>): Promise<void>  // applies the stored inverse
// pedirAprovacao/avisar: Telegram by default; the orchestrator passes the channel (Telegram or --consola)
```

```ts
// migrador/
analisar(dirApp: string): Promise<{ servicos: ('s3' | 'postgres' | 'fila' | 'segredos' | 'cache')[]; plano: string }>  // in this order
migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }>
migrarPostgres(): Promise<{ tabelas: number; linhas: number; checksumsOk: boolean }>  // level B, proof per table
migrarFila(): Promise<{ mensagens: number; iguais: boolean }>  // level B, SQS -> RabbitMQ: confirms first, only then deletes from SQS
migrarSegredos(): Promise<{ segredos: number; iguais: boolean }>  // level B, Secrets Manager + SSM -> OpenBao; never a value in a log (hack-leaseweb-1e)
migrarCache(): Promise<{ chaves: number; iguais: boolean }>  // level B, ElastiCache Redis -> Valkey; proof per key, type and value (agent 4)
aprovarPR(repo, numero, { token? }): Promise<{ commit? }>  // merge (squash) of the code migrator's PR, only after the "Approve PR" button
reverterPR(repo, numero, commit, { token? }): Promise<{ url?, ramo }>  // inverse: opens a PR with the revert; never pushes to main
verificar(): Promise<{ antes: boolean; depois: boolean }>   // same tests on both sides

// migrador/codigo.ts  (code migrator; always delivers a PR)
encontrarUsosAws(dirApp: string): Promise<{ ficheiro: string; linha: number; servico: 's3' | 'postgres' | 'fila' | 'outro'; trecho: string }[]>
proporAlteracao(usos: ReturnType<typeof encontrarUsosAws>): Promise<{ ficheiros: string[]; diff: string }>   // rules check that only the expected lines change
abrirPR(alteracao: { ficheiros: string[]; diff: string }, motivo: string): Promise<{ url: string; numero: number }>  // never a direct push to main
```

```ts
// migrador/tradutor/   (plan only, no API calls)
traduzir(tf: string | TerraformJson, opcoes?: { adminIp?: string }): PlanoTraducao  // create, replace, flag, refuse
resumoPlano(plano: PlanoTraducao): string                      // short text for Telegram
decidirDestino(entrada: EntradaDecisor): Decisao[]             // self-hosted or managed European (docs/decisor-destino.md)
mensagemDestino(decisoes: Decisao[], vm: CapacidadeVm): string
```

```ts
// shared/estado.ts   (requests in the process's memory; the audit log is the permanent record)
guardarPedido(p: Pedido): void
obterPedido(id: string): Pedido | undefined
mudarEstado(id: string, e: EstadoPedido): Pedido
listarPedidos(): Pedido[]
```

```ts
// chefe/   (measured numbers only, no AI)
resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string
estadoAtual(pedidos: Pedido[]): string                          // reply to /status
relogioExposicao(eventos, agora?): { inicio; fim?; segundos; aindaExposta } | undefined  // from the last 'infra-no-ar' to the first close
certificado(eventos, pedidos, localDados?, agora?): string      // migration certificate (LOCAL_DADOS)
```

```ts
// orquestrador.ts   (criarOrquestrador(deps, opcoes); index.ts wires the real modules)
// Migration: ONE "Approve plan" (the request of step 1); the other steps are born approved by it
// ('pedido' + 'aprovado' with depois.pelo = the plan's id). Each step has its own 'feito'/'erro' with the proof;
// verificar() runs only once, at the end, and the tests go into each step's proof.
// Optional dependencies (without them the step does not happen): migrador.migrarPostgres, migrarFila, migrarSegredos,
// migrarCache, migrador.planoInfra, migrador.planoDestino, chefe.certificado, relatorio.publicar.
// Events the orchestrator writes to the audit log: 'pedido', 'aprovado', 'ignorado', 'sem-resposta', 'feito',
// 'erro' (depois.fase), 'reconhecimento' (depois.portas), 'infra-no-ar', 'migracao-plano-infra', 'migracao-plano-destino'.
// Options: --sem-migrador, --sem-atacante, --sem-fila, --consola, --uma-vez; ESPERA_DECISAO_MS (10 min).
```

```ts
// shared/auditoria.ts
registar(e: EventoAuditoria): void   // one line per event in auditoria.jsonl
ler(): EventoAuditoria[]
```
