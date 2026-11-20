// Ciclo da defesa contra uma API da Leaseweb falsa (em memória): detetar -> corrigir -> desfazer.
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type { Pedido, Regra } from '@mwbe/shared';
import { auditoria, estado, leaseweb } from '@mwbe/shared';
import { avaliarRegra, correlacionar, corrigir, desfazer, detetar, inversoDe } from '@mwbe/defesa';

const SG = 'sg-vitima';
type RegraApi = Regra & { state: string };
let regras: RegraApi[];
let pedidosHttp: { metodo: string; caminho: string; corpo?: unknown }[];
let proximoId = 1;

/** Simula a API: revoke e authorize são assíncronos (a regra passa por DELETING / CREATING num passo). */
function apiFalsa(): typeof leaseweb.opcoes.fetch {
  return async (url, init) => {
    const caminho = String(url).replace('https://api.test', '');
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidosHttp.push({ metodo: init?.method ?? 'GET', caminho, corpo });
    assert.equal((init?.headers as Record<string, string>)['X-LSW-Auth'], 'chave-teste');
    const json = (s: number, b: unknown) => new Response(b === undefined ? '' : JSON.stringify(b), { status: s });

    // Avança as transições assíncronas a cada leitura.
    if (init?.method !== 'POST') {
      regras = regras.filter((r) => r.state !== 'DELETING_DONE');
      for (const r of regras) {
        if (r.state === 'DELETING') r.state = 'DELETING_DONE';
        if (r.state === 'CREATING') r.state = 'ACTIVE';
      }
    }
    if (caminho.startsWith('/securityGroups?')) return json(200, { securityGroups: [{ id: SG, name: 'vitima' }], _metadata: { totalCount: 1 } });
    if (caminho === `/securityGroups/${SG}/firewallRules`) return json(200, { firewallRules: regras });
    if (caminho === `/securityGroups/${SG}/revokeFirewallRules`) {
      for (const r of regras) if (corpo.rules.includes(r.id)) r.state = 'DELETING';
      return json(202, undefined);
    }
    if (caminho === `/securityGroups/${SG}/authorizeFirewallRules`) {
      for (const r of corpo.rules) regras.push({ id: `nova-${proximoId++}`, state: 'CREATING', ...r });
      return json(202, undefined);
    }
    return json(404, { errorMessage: 'não existe' });
  };
}

const regraPg: Regra = { id: 'r-pg', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };

beforeEach(() => {
  regras = [
    { ...regraPg, state: 'ACTIVE' },
    { id: 'r-ssh-admin', protocol: 'TCP', source: '203.0.113.10/32', startPort: 22, endPort: 22, state: 'ACTIVE' },
    { id: 'r-web', protocol: 'TCP', source: '0.0.0.0/0', startPort: 8080, endPort: 8080, state: 'ACTIVE' },
  ];
  pedidosHttp = [];
  process.env.LSW_API_BASE = 'https://api.test';
  process.env.LSW_API_KEY = 'chave-teste';
  process.env.LSW_SG_GERIDOS = SG;
  process.env.AUDITORIA_FICHEIRO = join(mkdtempSync(join(tmpdir(), 'audit-')), 'auditoria.jsonl');
  leaseweb.opcoes.fetch = apiFalsa();
  leaseweb.opcoes.intervaloMs = 1;
  leaseweb.opcoes.limiteMs = 2_000;
  estado.limparEstado();
});

describe('avaliarRegra', () => {
  it('PostgreSQL aberto ao mundo é severidade alta', () => {
    const a = avaliarRegra(SG, regraPg)!;
    assert.equal(a.severidade, 'alta');
    assert.equal(a.servico, 'PostgreSQL');
    assert.equal(a.porta, 5432);
  });
  it('porta não sensível aberta ao mundo é média; IPv6 ::/0 também conta', () => {
    assert.equal(avaliarRegra(SG, { ...regraPg, startPort: 8080, endPort: 8080 })!.severidade, 'media');
    assert.ok(avaliarRegra(SG, { ...regraPg, source: '::/0' }));
  });
  it('origem restrita ou ICMP não é achado', () => {
    assert.equal(avaliarRegra(SG, { ...regraPg, source: '203.0.113.10/32' }), undefined);
    assert.equal(avaliarRegra(SG, { ...regraPg, protocol: 'ICMP' }), undefined);
  });
  it('intervalo que inclui uma porta sensível usa essa porta', () => {
    assert.equal(avaliarRegra(SG, { ...regraPg, startPort: 3000, endPort: 4000 })!.porta, 3306);
  });
});

describe('correlacionar', () => {
  it('liga o achado do atacante à regra e tira o duplicado da API', () => {
    const daApi = [avaliarRegra(SG, regraPg)!];
    const doAtacante = [
      { id: 'at-1', tipo: 'servico-exposto', origem: 'atacante', alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL', severidade: 'alta', detalhe: 'nmap: 5432 open' },
      { id: 'at-2', tipo: 'servico-exposto', origem: 'atacante', alvo: '198.51.100.7', porta: 9999, servico: null, severidade: 'media', detalhe: 'nmap: 9999 open' },
    ] as const;
    const r = correlacionar(daApi, [...doAtacante], { [SG]: ['198.51.100.7'] });
    assert.equal(r.length, 2);
    assert.equal(r[0].regra?.id, 'r-pg');
    assert.equal(r[0].securityGroupId, SG);
    assert.equal(r[1].regra, undefined);
  });
});

describe('correlacionar sem prova de que o IP é do grupo', () => {
  it('não liga o SSH do isco à regra 22 da vítima (dois alvos na mesma porta)', () => {
    const ssh: Regra = { id: 'r-22', protocol: 'TCP', source: '0.0.0.0/0', startPort: 22, endPort: 22 };
    const daApi = [{ ...avaliarRegra(SG, ssh)!, alvo: '198.51.100.7' }];
    const isco = { id: 'at-isco', tipo: 'servico-exposto', origem: 'atacante', alvo: '203.0.113.99', porta: 22, servico: 'SSH', severidade: 'alta', detalhe: 'nmap: 22 open' } as const;
    const vitima = { ...isco, id: 'at-vitima', alvo: '198.51.100.7' };
    const r = correlacionar(daApi, [isco, vitima], { [SG]: ['198.51.100.7'] });
    assert.equal(r.find((a) => a.id === 'at-isco')?.regra, undefined);
    assert.equal(r.find((a) => a.id === 'at-vitima')?.regra?.id, 'r-22');
    // Sem mapa nenhum: nada se liga.
    assert.ok(correlacionar(daApi, [isco], {}).every((a) => a.id !== 'at-isco' || !a.regra));
  });
});

describe('ciclo detetar -> corrigir -> desfazer', () => {
  it('com LSW_SG_GERIDOS vazio falha alto (não diz "nada aberto" sem ter olhado)', async () => {
    process.env.LSW_SG_GERIDOS = '';
    await assert.rejects(detetar(), /LSW_SG_GERIDOS vazio/);
    assert.equal(pedidosHttp.length, 0);
  });

  it('o alvo do achado da API é o IP da instância quando se sabe (LSW_IP_SG)', async () => {
    process.env.LSW_IP_SG = `198.51.100.7=${SG}`;
    try {
      assert.equal((await detetar())[0].alvo, '198.51.100.7');
    } finally {
      delete process.env.LSW_IP_SG;
    }
  });

  it('avisa pelo canal que lhe passarem (plano B --consola)', async () => {
    const avisos: string[] = [];
    const pedido: Pedido = { id: 'p9', titulo: 'PG', texto: '', acao: { tipo: 'remover_regra', securityGroupId: SG, regra: regraPg }, estado: 'aprovado' };
    await corrigir(pedido, async (t) => void avisos.push(t));
    await desfazer('p9', async (t) => void avisos.push(t));
    assert.match(avisos[0], /Fechado e confirmado.*\/desfazer p9/);
    assert.match(avisos[1], /Desfeito/);
  });

  it('fecha só a regra culpada, audita o inverso e desfaz', async () => {
    const achados = await detetar();
    assert.deepEqual(achados.map((a) => a.porta), [5432, 8080]);

    const pedido: Pedido = {
      id: 'p1',
      titulo: 'PostgreSQL aberto a toda a internet',
      texto: '...',
      acao: { tipo: 'remover_regra', securityGroupId: SG, regra: achados[0].regra! },
      estado: 'aprovado',
    };
    estado.guardarPedido(pedido);
    assert.deepEqual(inversoDe(pedido), {
      tipo: 'criar_regra',
      securityGroupId: SG,
      regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 },
    });

    await corrigir(pedido);
    assert.deepEqual(regras.map((r) => r.id).sort(), ['r-ssh-admin', 'r-web']);
    assert.equal(estado.obterPedido('p1')?.estado, 'feito');
    const revokes = pedidosHttp.filter((p) => p.caminho.endsWith('revokeFirewallRules'));
    assert.deepEqual(revokes.map((p) => p.corpo), [{ rules: ['r-pg'] }]);
    assert.deepEqual(auditoria.ler().map((e) => e.tipo), ['a-aplicar', 'feito']);

    await desfazer('p1');
    const reposta = regras.find((r) => r.startPort === 5432)!;
    assert.equal(reposta.source, '0.0.0.0/0');
    assert.equal(reposta.state, 'ACTIVE');
    assert.equal(estado.obterPedido('p1')?.estado, 'desfeito');
    await assert.rejects(desfazer('p1'), /Nada para desfazer/);
  });

  it('recusa pedidos não aprovados e grupos não geridos', async () => {
    const base: Pedido = { id: 'p2', titulo: 't', texto: '', acao: { tipo: 'remover_regra', securityGroupId: SG, regra: regraPg }, estado: 'pendente' };
    await assert.rejects(corrigir(base), /não está aprovado/);
    await assert.rejects(
      corrigir({ ...base, estado: 'aprovado', acao: { ...base.acao, securityGroupId: 'sg-isco' } as Pedido['acao'] }),
      /LSW_SG_GERIDOS/,
    );
    assert.equal(pedidosHttp.filter((p) => p.metodo === 'POST').length, 0);
  });

  it('regra sem portas (todas) vira 1-65535 e é grave', async () => {
    leaseweb.opcoes.fetch = async () => new Response(JSON.stringify({ firewallRules: [{ id: 'r-any', protocol: 'ANY', source: '0.0.0.0/0', startPort: null, endPort: null }] }));
    const [r] = await leaseweb.listarRegras(SG);
    assert.deepEqual([r.startPort, r.endPort], [1, 65535]);
    assert.equal(avaliarRegra(SG, r)!.severidade, 'alta');
  });

  it('regra sem id na API falha alto (risco da documentação)', async () => {
    leaseweb.opcoes.fetch = async () => new Response(JSON.stringify({ firewallRules: [{ protocol: 'TCP', source: '0.0.0.0/0', startPort: 1, endPort: 1 }] }));
    await assert.rejects(leaseweb.listarRegras(SG), /sem id/);
  });
});

describe('nmap antes e depois do fecho', () => {
  it('regista open antes e filtered depois, só para IPs do grupo em ALVOS_PERMITIDOS', async () => {
    const { verificacao } = await import('../corrigir');
    const original = verificacao.estadoPorta;
    const vistos: string[] = [];
    let fechado = false;
    verificacao.estadoPorta = async (ip) => {
      vistos.push(ip);
      return fechado ? 'filtered' : 'open';
    };
    verificacao.intervaloMs = 1;
    process.env.LSW_IP_SG = `198.51.100.7=${SG},203.0.113.99=${SG}`;
    process.env.ALVOS_PERMITIDOS = '198.51.100.7';
    const fetchReal = leaseweb.opcoes.fetch;
    leaseweb.opcoes.fetch = async (url, init) => {
      if (String(init?.method) === 'POST' && String(url).endsWith('revokeFirewallRules')) fechado = true;
      return fetchReal(url, init);
    };
    try {
      const pedido: Pedido = { id: 'pv', titulo: 'PG', texto: '', acao: { tipo: 'remover_regra', securityGroupId: SG, regra: regraPg }, estado: 'aprovado' };
      await corrigir(pedido, async () => {});
      const v = auditoria.ler().filter((e) => e.tipo === 'verificado').map((e) => e.depois as { ip: string; fase: string; estado: string });
      assert.deepEqual(v, [
        { ip: '198.51.100.7', porta: 5432, fase: 'antes', estado: 'open' },
        { ip: '198.51.100.7', porta: 5432, fase: 'depois', estado: 'filtered' },
      ]);
      assert.ok(!vistos.includes('203.0.113.99'));
    } finally {
      verificacao.estadoPorta = original;
      delete process.env.LSW_IP_SG;
      process.env.ALVOS_PERMITIDOS = '';
    }
  });
});

describe('verificar-porta', () => {
  it('lê o estado da porta na saída do nmap', async () => {
    const { lerEstadoNmap } = await import('../verificar-porta');
    assert.equal(lerEstadoNmap('Host: 1.2.3.4 ()\tPorts: 5432/open/tcp//postgresql///', 5432), 'open');
    assert.equal(lerEstadoNmap('Host: 1.2.3.4 ()\tPorts: 5432/filtered/tcp//postgresql///', 5432), 'filtered');
    assert.equal(lerEstadoNmap('Host: 1.2.3.4 ()\tStatus: Down', 5432), 'desconhecido');
  });
  it('recusa IPs fora de ALVOS_PERMITIDOS', async () => {
    const { estadoPorta } = await import('../verificar-porta');
    process.env.ALVOS_PERMITIDOS = '198.51.100.7';
    await assert.rejects(estadoPorta('8.8.8.8', 53), /ALVOS_PERMITIDOS/);
  });
  it('recusa CIDR no pedido e na lista (não varre redes)', async () => {
    const { estadoPorta } = await import('../verificar-porta');
    process.env.ALVOS_PERMITIDOS = '198.51.100.0/24';
    await assert.rejects(estadoPorta('198.51.100.0/24', 5432), /não é um IP literal/);
    process.env.ALVOS_PERMITIDOS = '198.51.100.7,198.51.100.0/24';
    await assert.rejects(estadoPorta('198.51.100.7', 5432), /Entrada inválida/);
  });
});

describe('modo noite', () => {
  const pendente = (): Pedido => ({ id: 'pn', titulo: 'PostgreSQL aberto a toda a internet', texto: '', acao: { tipo: 'remover_regra', securityGroupId: SG, regra: regraPg }, estado: 'pendente' });

  it('sem configuração não faz nada', async () => {
    const { modoNoite } = await import('@mwbe/defesa');
    delete process.env.MODO_NOITE_MINUTOS;
    process.env.MODO_NOITE_IPS = '';
    estado.guardarPedido(pendente());
    assert.equal(await modoNoite(pendente(), async () => {}), false);
    assert.equal(pedidosHttp.filter((p) => p.metodo === 'POST').length, 0);
  });

  it('recusa "IPs conhecidos" que são o mundo', async () => {
    const { configModoNoite } = await import('@mwbe/defesa');
    process.env.MODO_NOITE_MINUTOS = '1';
    process.env.MODO_NOITE_IPS = '0.0.0.0/0';
    assert.equal(configModoNoite(), undefined);
  });

  it('deixa só os IPs conhecidos, fecha ao mundo, e o desfazer repõe tudo', async () => {
    const { modoNoite } = await import('@mwbe/defesa');
    process.env.MODO_NOITE_MINUTOS = '1';
    process.env.MODO_NOITE_IPS = '203.0.113.50';
    estado.guardarPedido(pendente());
    const avisos: string[] = [];
    assert.equal(await modoNoite(pendente(), async (t) => void avisos.push(t)), true);
    const pg = () => regras.filter((r) => r.startPort === 5432).map((r) => r.source).sort();
    assert.deepEqual(pg(), ['203.0.113.50/32']);
    assert.equal(estado.obterPedido('pn')?.estado, 'feito');
    assert.match(avisos[0], /Modo noite.*203\.0\.113\.50\/32.*\/desfazer pn/);
    // authorize antes do revoke
    const posts = pedidosHttp.filter((p) => p.metodo === 'POST').map((p) => p.caminho.split('/').pop());
    assert.deepEqual(posts, ['authorizeFirewallRules', 'revokeFirewallRules']);

    await desfazer('pn', async () => {});
    assert.deepEqual(pg(), ['0.0.0.0/0']);
    // Um aprovar tardio já não mexe: o pedido deixou de estar pendente.
    assert.equal(await modoNoite(pendente(), async () => {}), false);
  });

  it('durante o modo noite o pedido já não está pendente (um Aprovar a meio é ignorado)', async () => {
    const { modoNoite } = await import('@mwbe/defesa');
    process.env.MODO_NOITE_MINUTOS = '1';
    process.env.MODO_NOITE_IPS = '203.0.113.50';
    estado.guardarPedido(pendente());
    const vistos: string[] = [];
    const fetchReal = leaseweb.opcoes.fetch;
    leaseweb.opcoes.fetch = async (url, init) => {
      vistos.push(estado.obterPedido('pn')!.estado);
      return fetchReal(url, init);
    };
    assert.equal(await modoNoite(pendente(), async () => {}), true);
    assert.ok(vistos.length > 0 && vistos.every((e) => e === 'aprovado'));
  });

  it('se falhar a meio, o pedido volta a pendente', async () => {
    const { modoNoite } = await import('@mwbe/defesa');
    process.env.MODO_NOITE_MINUTOS = '1';
    process.env.MODO_NOITE_IPS = '203.0.113.50';
    estado.guardarPedido(pendente());
    leaseweb.opcoes.fetch = async () => new Response('erro', { status: 500 });
    assert.equal(await modoNoite(pendente(), async () => {}), false);
    assert.equal(estado.obterPedido('pn')?.estado, 'pendente');
  });

  it('porta não sensível não entra no modo noite', async () => {
    const { modoNoite } = await import('@mwbe/defesa');
    process.env.MODO_NOITE_MINUTOS = '1';
    process.env.MODO_NOITE_IPS = '203.0.113.50';
    const web = { ...pendente(), id: 'pw', acao: { tipo: 'remover_regra' as const, securityGroupId: SG, regra: { ...regraPg, id: 'r-web', startPort: 8080, endPort: 8080 } } };
    estado.guardarPedido(web);
    assert.equal(await modoNoite(web, async () => {}), false);
  });
});

describe('fecho confirmado de fora (medido a 20/11: firewall ~3 s, API ~39 s)', () => {
  it('regra presa em DELETING: confirma pelo nmap em vez de esperar pela API', async () => {
    let revogada = false;
    leaseweb.opcoes.fetch = async (url, init) => {
      if (String(url).endsWith('revokeFirewallRules')) {
        revogada = true;
        return new Response('', { status: 202 });
      }
      const estado = revogada ? 'DELETING' : 'ACTIVE';
      return new Response(JSON.stringify({ firewallRules: [{ ...regraPg, state: estado }] }));
    };
    leaseweb.opcoes.limiteMs = 500;
    let chamadas = 0;
    const r = await leaseweb.removerRegra(SG, 'r-pg', { confirmadoDeFora: async () => ++chamadas >= 2 });
    assert.equal(r.confirmacao, 'de-fora');
    // Sem confirmação de fora e a API presa: não diz "fechado", esgota o tempo.
    revogada = false;
    await assert.rejects(leaseweb.removerRegra(SG, 'r-pg'), /Tempo esgotado/);
  });
});

describe('rede instável (fetch failed visto a 20/11)', () => {
  it('GET repete; POST só repete se a ligação nem abriu', async () => {
    let n = 0;
    leaseweb.opcoes.fetch = async () => {
      if (n++ === 0) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return new Response(JSON.stringify({ firewallRules: [] }));
    };
    assert.deepEqual(await leaseweb.listarRegras(SG), []);
    n = 0;
    await assert.rejects(leaseweb.pedido('POST', `/securityGroups/${SG}/revokeFirewallRules`, { rules: ['x'] }), /erro de rede \(ECONNRESET\)/);
    n = 0;
    leaseweb.opcoes.fetch = async () => {
      if (n++ === 0) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return new Response('', { status: 202 });
    };
    await leaseweb.pedido('POST', `/securityGroups/${SG}/revokeFirewallRules`, { rules: ['x'] });
    assert.equal(n, 2);
  });
});

describe('botão Desfazer do relatório (Telegram)', () => {
  it('liga aoDesfazer ao desfazer, um de cada vez por pedido, e avisa se falhar', async () => {
    const { ligarDesfazer } = await import('@mwbe/defesa');
    let cb: ((id: string, quem: string) => void) | undefined;
    const avisos: string[] = [];
    const feitos: string[] = [];
    let soltar: () => void = () => {};
    ligarDesfazer(
      { aoDesfazer: (f) => void (cb = f), notificar: async (t) => void avisos.push(t) },
      async (id) => {
        feitos.push(id);
        if (id === 'mau') throw new Error('Nada para desfazer');
        await new Promise<void>((ok) => (soltar = ok));
      },
    );
    cb!('p1', '123');
    cb!('p1', '123'); // segundo clique enquanto o primeiro corre: ignorado
    soltar();
    await new Promise((ok) => setTimeout(ok, 5));
    cb!('mau', '123');
    await new Promise((ok) => setTimeout(ok, 5));
    assert.deepEqual(feitos, ['p1', 'mau']);
    assert.match(avisos[0], /Não consegui desfazer mau/);
  });
});
