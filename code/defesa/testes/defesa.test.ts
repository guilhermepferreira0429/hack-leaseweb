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
    const r = correlacionar(daApi, [...doAtacante]);
    assert.equal(r.length, 2);
    assert.equal(r[0].regra?.id, 'r-pg');
    assert.equal(r[0].securityGroupId, SG);
    assert.equal(r[1].regra, undefined);
  });
});

describe('ciclo detetar -> corrigir -> desfazer', () => {
  it('só olha para os security groups geridos', async () => {
    process.env.LSW_SG_GERIDOS = '';
    assert.deepEqual(await detetar(), []);
    assert.equal(pedidosHttp.length, 0);
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

  it('regra sem id na API falha alto (risco da documentação)', async () => {
    leaseweb.opcoes.fetch = async () => new Response(JSON.stringify({ firewallRules: [{ protocol: 'TCP', source: '0.0.0.0/0', startPort: 1, endPort: 1 }] }));
    await assert.rejects(leaseweb.listarRegras(SG), /sem id/);
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
});
