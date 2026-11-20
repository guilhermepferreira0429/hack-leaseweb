// Lógica do orquestrador, com as dependências injetadas (testável sem Telegram, Leaseweb nem nmap).
// code/index.ts liga isto aos módulos reais.
//
// Fluxo (docs/agentes-telegram.md, docs/demo.md):
//   migrar   migrador.analisar -> pedido 'migrar s3' -> aprovação -> migrarS3 -> verificar
//   atacar   atacante.reconhecer(ALVOS_PERMITIDOS)
//   defender defesa.detetar (API) + correlacionar -> tratar cada achado com regra
//   fechar   aprovado -> defesa.corrigir -> atacante volta a confirmar
//   resumir  chefe.resumir
// Cortes (docs/plano.md): sem migrador e/ou sem atacante; a defesa pela API fica sempre.
// Uma falha numa fase é auditada e avisada, e o fluxo continua: a demo não pára.
import type { Achado, Agente, Decisao, EventoAuditoria, Mensagem, Pedido, EstadoPedido } from '@mwbe/shared';

export interface Dependencias {
  telegram: {
    pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void>;
    aoResponder(cb: (pedidoId: string, decisao: Decisao, quem: string) => void): void;
    aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void;
    notificar(texto: string): Promise<void>;
  };
  bus: { enviar(m: Mensagem): void };
  estado: {
    guardarPedido(p: Pedido): void;
    obterPedido(id: string): Pedido | undefined;
    mudarEstado(id: string, e: EstadoPedido): Pedido;
    listarPedidos(): Pedido[];
  };
  auditoria: { registar(e: EventoAuditoria): void; ler(): EventoAuditoria[] };
  defesa: {
    detetar(): Promise<Achado[]>;
    correlacionar(daApi: Achado[], doAtacante: Achado[]): Achado[];
    acaoPara(achado: Achado): Pedido['acao'] | undefined;
    tratar(achado: Achado): Promise<Pedido>;
    corrigir(pedido: Pedido): Promise<void>;
    desfazer(pedidoId: string): Promise<void>;
    novoIdPedido(): string;
  };
  atacante: { reconhecer(alvos: string[]): Promise<Achado[]> };
  migrador: {
    analisar(dirApp: string): Promise<{ servicos: ('s3' | 'postgres' | 'fila')[]; plano: string }>;
    migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }>;
    verificar(): Promise<{ antes: boolean; depois: boolean }>;
  };
  chefe: { resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string; estadoAtual(pedidos: Pedido[]): string };
}

export interface Opcoes {
  migrar: boolean;
  atacar: boolean;
  dirApp: string;
  alvos: string[];
  /** Se definido, só aceita decisões e comandos deste utilizador (defesa em profundidade; o telegram.ts já filtra). */
  donoId?: string;
  agora?: () => Date;
  log?: (...args: unknown[]) => void;
}

export type Resultado = 'feito' | 'ignorado' | 'falhou' | 'aprovado';

const NOME_SERVICO: Record<'s3' | 'postgres' | 'fila', string> = { s3: 'S3', postgres: 'Postgres', fila: 'SQS' };

export function criarOrquestrador(deps: Dependencias, opcoes: Opcoes) {
  const agora = opcoes.agora ?? (() => new Date());
  const log = opcoes.log ?? ((...a: unknown[]) => console.log('[orquestrador]', ...a));
  const espera = new Map<string, (r: Resultado) => void>();

  const hora = () => agora().toISOString();
  const horaCurta = () =>
    agora().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
  // As peças dos outros podem ainda ser stubs que lançam de forma síncrona: nada disso pode parar a demo.
  function falar(de: Agente, para: Mensagem['para'], texto: string): void {
    try {
      deps.bus.enviar({ de, para, texto });
    } catch (erro) {
      log(`bus falhou (${de} -> ${para}):`, mensagem(erro), '|', texto);
    }
  }

  /** Cópia local do que se auditou: se a auditoria falhar, o resumo do chefe continua a ter números. */
  const eventosLocais: EventoAuditoria[] = [];

  function auditar(e: Omit<EventoAuditoria, 'hora'>): void {
    const evento = { hora: hora(), ...e };
    eventosLocais.push(evento);
    try {
      deps.auditoria.registar(evento);
    } catch (erro) {
      log('auditoria falhou:', mensagem(erro));
    }
  }

  function lerAuditoria(): EventoAuditoria[] {
    try {
      return deps.auditoria.ler();
    } catch (erro) {
      log('auditoria.ler falhou, a usar a cópia local:', mensagem(erro));
      return eventosLocais;
    }
  }

  async function notificar(texto: string): Promise<void> {
    try {
      await deps.telegram.notificar(texto);
    } catch (erro) {
      log('notificar falhou:', mensagem(erro), '|', texto);
    }
  }

  async function falha(fase: string, erro: unknown): Promise<void> {
    log(`${fase} falhou:`, mensagem(erro));
    auditar({ pedidoId: '-', tipo: 'erro', quem: 'orquestrador', depois: { fase, erro: mensagem(erro) } });
    await notificar(`Falha em ${fase}: ${mensagem(erro)}. A demo continua.`);
  }

  /** Respostas que chegaram antes de alguém estar à espera (o dono pode ser mais rápido do que o fluxo). */
  const antecipados = new Map<string, Resultado>();

  function esperarResultado(pedidoId: string): Promise<Resultado> {
    const ja = antecipados.get(pedidoId);
    if (ja) {
      antecipados.delete(pedidoId);
      return Promise.resolve(ja);
    }
    return new Promise((resolve) => espera.set(pedidoId, resolve));
  }

  function concluir(pedidoId: string, r: Resultado): void {
    const resolver = espera.get(pedidoId);
    if (resolver) {
      espera.delete(pedidoId);
      resolver(r);
    } else {
      antecipados.set(pedidoId, r);
    }
  }

  // ---------- respostas do dono ----------

  async function aoResponder(pedidoId: string, decisao: Decisao, quem: string): Promise<void> {
    if (opcoes.donoId && quem !== opcoes.donoId) {
      log(`decisão de ${quem} ignorada (não é o dono)`);
      return;
    }
    const pedido = deps.estado.obterPedido(pedidoId);
    if (!pedido || pedido.estado !== 'pendente') {
      log(`decisão para ${pedidoId} ignorada (${pedido ? `estado ${pedido.estado}` : 'pedido desconhecido'})`);
      return;
    }
    const aprovado = decisao === 'aprovar';
    deps.estado.mudarEstado(pedidoId, aprovado ? 'aprovado' : 'ignorado');
    auditar({ pedidoId, tipo: aprovado ? 'aprovado' : 'ignorado', quem });

    if (!aprovado) return concluir(pedidoId, 'ignorado');
    // A migração continua no próprio fluxo (faseMigrar está à espera).
    if (pedido.acao.tipo === 'migrar') return concluir(pedidoId, 'aprovado');

    try {
      await deps.defesa.corrigir({ ...pedido, estado: 'aprovado' });
    } catch (erro) {
      await falha(`fechar "${pedido.titulo}"`, erro);
      falar('defesa', 'dono', `Não consegui fechar "${pedido.titulo}". Nada foi alterado sem confirmação; vejam o painel.`);
      return concluir(pedidoId, 'falhou');
    }
    // O aviso "Fechado e confirmado às HH:MM ... /desfazer <id>" já vem do corrigir(); aqui só se passa a vez ao atacante.
    falar('defesa', 'atacante', `@atacante, fechei "${pedido.titulo}" às ${horaCurta()} e guardei como voltar atrás. Podes confirmar?`);
    if (opcoes.atacar) await confirmarFecho(pedido);
    concluir(pedidoId, 'feito');
  }

  /** O atacante volta à porta que foi fechada e diz se ainda lá chega. */
  async function confirmarFecho(pedido: Pedido): Promise<void> {
    if (pedido.acao.tipo !== 'remover_regra') return;
    const { startPort, endPort } = pedido.acao.regra;
    try {
      const achados = await deps.atacante.reconhecer(opcoes.alvos);
      const ainda = achados.filter((a) => a.porta >= startPort && a.porta <= endPort);
      falar(
        'atacante',
        'todos',
        ainda.length === 0
          ? 'Confirmo. Já não chego lá.'
          : `Ainda chego à porta ${ainda[0].porta} em ${ainda[0].alvo}. Pode demorar uns segundos a aplicar.`,
      );
    } catch (erro) {
      await falha('confirmação do atacante', erro);
    }
  }

  async function aoMensagemDoDono(agente: Agente | null, texto: string): Promise<void> {
    const t = texto.trim();
    if (t === '/estado' || t.startsWith('/estado@')) {
      await notificar(deps.chefe.estadoAtual(deps.estado.listarPedidos()));
      return;
    }
    const desfazer = t.match(/^\/desfazer(?:@\S+)?\s+(\S+)/);
    if (desfazer) {
      const id = desfazer[1];
      try {
        await deps.defesa.desfazer(id);
        falar('defesa', 'dono', `Desfeito: a regra do pedido ${id} foi reposta e confirmada.`);
      } catch (erro) {
        await falha(`desfazer ${id}`, erro);
      }
      return;
    }
    // TODO 13:30 (voz dos agentes): responder com o LLM no papel de `agente`.
    log(`mensagem do dono para ${agente ?? 'ninguém'} sem comando: ${t.slice(0, 80)}`);
  }

  // ---------- fases ----------

  async function faseMigrar(): Promise<void> {
    const { servicos, plano } = await deps.migrador.analisar(opcoes.dirApp);
    const nomes = servicos.map((s) => NOME_SERVICO[s]).join(', ');
    falar('migrador', 'dono', `Encontrei ${servicos.length} serviços AWS na app: ${nomes}. Começo pelo S3 para MinIO na Leaseweb.`);
    if (!servicos.includes('s3')) return;

    const pedido: Pedido = {
      id: deps.defesa.novoIdPedido(),
      titulo: 'Migrar ficheiros do S3 para MinIO na Leaseweb',
      texto: plano,
      acao: { tipo: 'migrar', passo: 's3' },
      estado: 'pendente',
    };
    deps.estado.guardarPedido(pedido);
    auditar({ pedidoId: pedido.id, tipo: 'pedido', quem: 'migrador', depois: { servicos, plano } });
    const decisao = esperarResultado(pedido.id);
    await deps.telegram.pedirAprovacao('migrador', pedido);
    if ((await decisao) !== 'aprovado') {
      falar('migrador', 'dono', 'Migração não aprovada. Fica tudo como estava.');
      return;
    }

    const copia = await deps.migrador.migrarS3();
    const testes = await deps.migrador.verificar();
    const ok = copia.checksumsOk && testes.antes && testes.depois;
    deps.estado.mudarEstado(pedido.id, ok ? 'feito' : 'aprovado');
    auditar({ pedidoId: pedido.id, tipo: ok ? 'feito' : 'erro', quem: 'migrador', depois: { ...copia, testes } });
    falar(
      'migrador',
      'atacante',
      `${copia.objetos} ficheiros copiados, checksums ${copia.checksumsOk ? 'iguais' : 'DIFERENTES'}, ` +
        `testes ${testes.antes && testes.depois ? 'a passar dos dois lados' : `antes ${testes.antes ? 'ok' : 'falharam'}, depois ${testes.depois ? 'ok' : 'falharam'}`}. ` +
        '@atacante, a infraestrutura nova está no ar.',
    );
  }

  async function faseAtacar(): Promise<Achado[]> {
    const achados = await deps.atacante.reconhecer(opcoes.alvos);
    auditar({ pedidoId: '-', tipo: 'reconhecimento', quem: 'atacante', depois: { alvos: opcoes.alvos, achados: achados.length } });
    falar('atacante', 'defesa', textoAtacante(achados));
    return achados;
  }

  async function faseDefender(doAtacante: Achado[]): Promise<Promise<Resultado>[]> {
    let daApi: Achado[] = [];
    try {
      daApi = await deps.defesa.detetar();
    } catch (erro) {
      await falha('deteção pela API', erro);
    }
    let achados: Achado[];
    try {
      achados = deps.defesa.correlacionar(daApi, doAtacante);
    } catch (erro) {
      // Sem correlação ficam só os achados da API: são os que trazem a regra a fechar.
      log('correlacionar falhou, a usar só os achados da API:', mensagem(erro));
      achados = daApi;
    }
    const acionaveis = achados.filter((a) => deps.defesa.acaoPara(a));
    if (acionaveis.length === 0) {
      falar('defesa', 'dono', achados.length === 0 ? 'Não encontrei nada aberto a toda a internet.' : 'Há portas visíveis, mas nenhuma regra nossa para fechar.');
      return [];
    }
    const resultados: Promise<Resultado>[] = [];
    for (const achado of acionaveis) {
      try {
        const pedido = await deps.defesa.tratar(achado);
        resultados.push(esperarResultado(pedido.id));
      } catch (erro) {
        await falha(`pedido para ${achado.alvo}:${achado.porta}`, erro);
      }
    }
    return resultados;
  }

  async function correr(): Promise<void> {
    if (opcoes.migrar) await faseMigrar().catch((e) => falha('migração', e));
    let doAtacante: Achado[] = [];
    if (opcoes.atacar) doAtacante = await faseAtacar().catch(async (e) => (await falha('reconhecimento', e), []));
    const resultados = await faseDefender(doAtacante);
    await Promise.all(resultados);
    falar('chefe', 'dono', deps.chefe.resumir(lerAuditoria(), deps.estado.listarPedidos()));
  }

  function ligar(): void {
    deps.telegram.aoResponder((id, decisao, quem) => {
      aoResponder(id, decisao, quem).catch((e) => falha('resposta do dono', e));
    });
    deps.telegram.aoMensagemDoDono((agente, texto) => {
      aoMensagemDoDono(agente, texto).catch((e) => falha('mensagem do dono', e));
    });
  }

  return { ligar, correr, aoResponder, aoMensagemDoDono };
}

/** Fala do atacante a partir dos achados (determinística; a voz com IA vem depois). */
export function textoAtacante(achados: Achado[]): string {
  if (achados.length === 0) return 'Recebido. Não encontrei portas abertas nas nossas máquinas. @defesa';
  const altas = achados.filter((a) => a.severidade === 'alta');
  const lista = achados
    .slice(0, 3)
    .map((a) => `${a.servico ?? 'serviço'} na porta ${a.porta} (${a.alvo})`)
    .join('; ');
  const resto = achados.length > 3 ? ` e mais ${achados.length - 3}` : '';
  return `Recebido. Responde a qualquer pessoa na internet: ${lista}${resto}. Gravidade ${altas.length > 0 ? 'alta' : 'média'}. @defesa`;
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
