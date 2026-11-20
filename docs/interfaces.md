# Interfaces (fixas; mudar só com aviso no grupo)

```ts
// shared/tipos.ts
export type Regra = { id: string; protocol: string; source: string; startPort: number; endPort: number };

export type Achado = {
  id: string;
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
  | { tipo: 'migrar'; passo: 's3' | 'postgres' | 'fila' };

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
explicar(achado: Achado): Promise<string>   // 3 frases, timeout 20 s, recurso texto fixo
```

```ts
// shared/telegram.ts  (long polling, sem webhook)
pedirAprovacao(pedido: Pedido): Promise<void>        // mensagem com botões: "Aprovar" / "Ignorar"
aoResponder(cb: (pedidoId: string, decisao: 'aprovar' | 'ignorar', quem: string) => void): void
notificar(texto: string): Promise<void>
// comandos: /estado, /desfazer <pedidoId>
```

```ts
// atacante/reconhecimento.ts
reconhecer(alvos: string[]): Promise<Achado[]>   // recusa IPs fora de ALVOS_PERMITIDOS
```

```ts
// defesa/
detetar(): Promise<Achado[]>                 // regras com source 0.0.0.0/0 ou ::/0
tratar(achado: Achado): Promise<Pedido>      // explica e pede aprovação
corrigir(pedido: Pedido): Promise<void>      // executa a Acao, verifica, audita
desfazer(pedidoId: string): Promise<void>    // aplica o inverso guardado
```

```ts
// migrador/
analisar(dirApp: string): Promise<{ servicos: ('s3' | 'postgres' | 'fila')[]; plano: string }>
migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }>
verificar(): Promise<{ antes: boolean; depois: boolean }>   // mesmos testes nos dois lados
```

```ts
// shared/auditoria.ts
registar(e: EventoAuditoria): void   // uma linha por evento em auditoria.jsonl
ler(): EventoAuditoria[]
```
