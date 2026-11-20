import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { contarLinhas, faseDe, renderizar } from '@mwbe/painel';

const LOG = `2026-11-20T09:37:32.1+00:00 h sshd-session[3051]: Connection closed by authenticating user root 192.0.2.80 port 51242 [preauth]
2026-11-20T09:43:41.1+00:00 h sshd-session[3111]: Failed password for root from 192.0.2.80 port 56446 ssh2
2026-11-20T09:43:42.1+00:00 h sshd-session[3111]: Connection closed by authenticating user root 192.0.2.80 port 56446 [preauth]
2026-11-20T09:44:00.1+00:00 h sshd-session[3200]: Invalid user admin from 45.1.2.3 port 1 
2026-11-20T09:45:00.1+00:00 h sshd-session[3300]: Accepted publickey for ubuntu from 198.51.100.24 port 2 ssh2
2026-11-20T09:45:48.1+00:00 h sshd-session[3116]: Connection closed by authenticating user ubuntu 198.51.100.24 port 31481 [preauth]`;

describe('isco', () => {
  it('conta sessões e IPs distintos, ignora os nossos IPs e logins aceites', () => {
    assert.deepEqual(contarLinhas(LOG, ['198.51.100.24']), { tentativas: 3, ipsDistintos: 2, desde: '2026-11-20T09:37:32.1+00:00' });
  });
});

describe('isco: logins da equipa', () => {
  it('um IP que entrou com sucesso é da equipa e não conta, mesmo com falhas antes', () => {
    const log = `2026-11-20T09:00:00+00:00 h sshd-session[1]: Connection closed by authenticating user ubuntu 198.51.100.24 port 1 [preauth]
2026-11-20T09:00:05+00:00 h sshd-session[2]: Accepted publickey for ubuntu from 198.51.100.24 port 2 ssh2
2026-11-20T09:01:00+00:00 h sshd-session[3]: Invalid user admin from 45.1.2.3 port 1`;
    assert.deepEqual(contarLinhas(log), { tentativas: 1, ipsDistintos: 1, desde: '2026-11-20T09:01:00+00:00' });
  });
});

describe('linha do tempo', () => {
  it('fases pelo tipo do evento', () => {
    assert.equal(faseDe({ hora: '', pedidoId: 'p', tipo: 'feito' }), 'fechar');
    assert.equal(faseDe({ hora: '', pedidoId: 'p', tipo: 'achado' }), 'atacar');
    assert.equal(faseDe({ hora: '', pedidoId: 'p', tipo: 'aprovado' }), 'aprovar');
    assert.equal(faseDe({ hora: '', pedidoId: 'p', tipo: 'migrado-s3' }), 'migrar');
  });
  it('escapa texto', () => {
    const html = renderizar([{ id: 'p1', titulo: '<script>x</script>', texto: '', estado: 'feito', acao: { tipo: 'migrar', passo: 's3' } }], []);
    assert.ok(!html.includes('<script>x'));
  });
});

describe('relógio de exposição', () => {
  it('mostra o relógio do chefe: vermelho enquanto exposta, verde depois', () => {
    const inv = { tipo: 'criar_regra', securityGroupId: 's', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;
    const ev = [
      { hora: '2026-11-20T10:00:00Z', pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
      { hora: '2026-11-20T10:00:38Z', pedidoId: 'p', tipo: 'feito', inverso: inv },
    ];
    const html = renderizar([], ev);
    assert.match(html, /class="relogio fechada"/);
    assert.match(html, /<div class="seg">38 s<\/div>/);
    assert.match(html, /FECHADO \d\d:\d\d:\d\d/);
    assert.match(renderizar([], ev.slice(0, 1)), /class="relogio exposta"/);
    assert.match(renderizar([], []), /à espera da infraestrutura nova/);
  });
  it('isco conta só dentro da janela', () => {
    const r = contarLinhas(LOG, [], { desde: Date.parse('2026-11-20T09:40:00Z'), ate: Date.parse('2026-11-20T09:44:30Z') });
    assert.equal(r.tentativas, 2);
  });
});

describe('POST /desfazer', () => {
  it('recusa sem token, com token errado e com outra origem; aceita o certo', async () => {
    const { iniciarPainel } = await import('@mwbe/painel');
    const feitos: string[] = [];
    process.env.PAINEL_TOKEN = 'segredo';
    const srv = iniciarPainel(0, { host: '127.0.0.1', desfazer: async (id) => void feitos.push(id) });
    await new Promise((ok) => srv.once('listening', ok));
    const porta = (srv.address() as { port: number }).port;
    const post = (corpo: string, origin?: string) =>
      fetch(`http://127.0.0.1:${porta}/desfazer`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) },
        body: corpo,
      });
    try {
      assert.equal((await post('id=p1&token=errado')).status, 403);
      assert.equal((await post('id=p1&token=segredo', 'http://mau.example')).status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${porta}/desfazer?id=p1&token=segredo`)).status, 404);
      assert.equal((await post('id=p1&token=segredo', `http://127.0.0.1:${porta}`)).status, 303);
      assert.deepEqual(feitos, ['p1']);
      process.env.PAINEL_TOKEN = '';
      assert.equal((await post('id=p1&token=')).status, 403);
    } finally {
      srv.close();
    }
  });
});

describe('ecrã da demo (4 zonas)', () => {
  it('agentes, frases, ciclo atual e estado da porta', async () => {
    const { agenteDe, fraseDe, cicloAtual, portasDoCiclo } = await import('@mwbe/painel');
    const regra = { id: 'r', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
    const inv = { tipo: 'criar_regra', securityGroupId: 's', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;
    const ev = [
      { hora: '2026-11-20T09:00:00Z', pedidoId: 'velho', tipo: 'feito', quem: 'defesa', inverso: inv },
      { hora: '2026-11-20T10:00:00Z', pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
      { hora: '2026-11-20T10:00:05Z', pedidoId: '-', tipo: 'reconhecimento', quem: 'atacante', depois: { portas: [{ alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }] } },
      { hora: '2026-11-20T10:00:10Z', pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado: { alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }, titulo: 'PostgreSQL aberto' } },
      { hora: '2026-11-20T10:00:20Z', pedidoId: 'p1', tipo: 'aprovado', quem: '12345' },
      { hora: '2026-11-20T10:00:21Z', pedidoId: 'p1', tipo: 'a-aplicar', quem: 'defesa', antes: regra, inverso: inv },
      { hora: '2026-11-20T10:00:38Z', pedidoId: 'p1', tipo: 'feito', quem: 'defesa', inverso: inv },
    ];
    const ciclo = cicloAtual(ev);
    assert.equal(ciclo[0].tipo, 'infra-no-ar');
    assert.deepEqual(ciclo.map(agenteDe), ['chefe', 'atacante', 'defesa', 'dono', 'defesa', 'defesa']);
    assert.equal(fraseDe(ciclo[1]), 'Aberto a toda a Internet: PostgreSQL 5432.');
    assert.equal(fraseDe(ciclo[4]), 'A fechar TCP 5432 de 0.0.0.0/0.');
    assert.deepEqual(portasDoCiclo(ciclo).map((p) => p.estado), ['fechada']);
    assert.deepEqual(portasDoCiclo(ciclo.slice(0, 3)).map((p) => p.estado), ['aberta']);

    const pedido = { id: 'p1', titulo: 'PostgreSQL aberto', texto: '', estado: 'feito' as const, acao: { tipo: 'remover_regra' as const, securityGroupId: 's', regra } };
    const html = renderizar([pedido], ev, 'tk');
    assert.match(html, /<div class="seg">38 s<\/div>/);
    assert.match(html, /Desfazer última ação/);
    assert.match(html, /name="id" value="p1"/);
    assert.match(html, /dono · Telegram/);
    assert.ok(!html.includes('velho'));
  });
});

describe('painel escuta só em 127.0.0.1 por omissão', () => {
  it('PAINEL_HOST vazio não abre a todas as interfaces', async () => {
    const { iniciarPainel } = await import('@mwbe/painel');
    process.env.PAINEL_HOST = '';
    const srv = iniciarPainel(0);
    await new Promise((ok) => srv.once('listening', ok));
    try {
      assert.equal((srv.address() as { address: string }).address, '127.0.0.1');
    } finally {
      srv.close();
    }
  });
});

describe('certificado, provas e isco (ecrãs do desenho)', () => {
  const inv = { tipo: 'criar_regra', securityGroupId: 's', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;
  const regra = { id: 'r', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
  const ev = [
    { hora: '2026-11-20T10:00:00Z', pedidoId: 'm1', tipo: 'pedido', quem: 'migrador' },
    { hora: '2026-11-20T10:00:05Z', pedidoId: 'm1', tipo: 'feito', quem: 'migrador', depois: { objetos: 1540, checksumsOk: true, testes: { antes: true, depois: true } } },
    { hora: '2026-11-20T10:00:06Z', pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
    { hora: '2026-11-20T10:00:09Z', pedidoId: 'm2', tipo: 'feito', quem: 'migrador', depois: { tabelas: 5, linhas: 17518, checksumsOk: true, testes: { antes: true, depois: true } } },
    { hora: '2026-11-20T10:00:10Z', pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado: { alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }, titulo: 'PostgreSQL aberto a toda a internet' } },
    { hora: '2026-11-20T10:00:20Z', pedidoId: 'p1', tipo: 'aprovado', quem: 'consola' },
    { hora: '2026-11-20T10:00:21Z', pedidoId: 'p1', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'antes', estado: 'open' } },
    { hora: '2026-11-20T10:00:30Z', pedidoId: 'p1', tipo: 'feito', quem: 'defesa', inverso: inv },
    { hora: '2026-11-20T10:00:33Z', pedidoId: 'p1', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'depois', estado: 'filtered' } },
  ];
  const pedidos = [{ id: 'p1', titulo: 'PostgreSQL aberto a toda a internet', texto: '', estado: 'feito' as const, acao: { tipo: 'remover_regra' as const, securityGroupId: 's', regra } }];

  it('provas: migração dos dois passos e nmap antes/depois', async () => {
    const { provas, cicloAtual } = await import('@mwbe/painel');
    const p = provas(cicloAtual(ev));
    assert.equal(p.objetos, 1540);
    assert.equal(p.linhas, 17518);
    assert.equal(p.checksums, true);
    assert.deepEqual([p.nmapAntes?.estado, p.nmapDepois?.estado], ['open', 'filtered']);
    assert.equal(p.ultimoFecho?.pedidoId, 'p1');
  });

  it('certificado só com números medidos', async () => {
    const { renderizarCertificado } = await import('@mwbe/painel');
    const html = renderizarCertificado(pedidos, ev, 'Leaseweb, Amesterdão (NL)', new Date('2026-11-20T10:05:00Z'));
    assert.match(html, /A migração terminou e ficou segura\./);
    assert.match(html, /1\.540 copiados/);
    assert.match(html, /17\.518 linhas em 5 tabelas/);
    assert.match(html, /Tempo exposto<\/span><span>24 s/);
    assert.match(html, /5432 filtered ✓/);
    assert.match(html, /\/desfazer p1/);
    assert.match(html, /dono · consola/);
    const semFecho = renderizarCertificado([], ev.slice(0, 5));
    assert.match(semFecho, /Há pontos por fechar/);
  });

  it('isco: hora de arranque a partir de /proc/uptime e ecrã sem QR por omissão', async () => {
    const { ligadaDesde, renderizarIsco } = await import('@mwbe/painel');
    assert.equal(ligadaDesde('3600.5 1234.0\n', Date.parse('2026-11-20T10:00:00Z')), '2026-11-20T08:59:59.500Z');
    assert.equal(ligadaDesde('lixo'), undefined);
    const html = renderizarIsco({ tentativas: 4317, ipsDistintos: 389, desde: '2026-11-20T08:00:00Z', lidoEm: '2026-11-20T10:00:00Z', ligadaEm: '2026-11-20T07:45:00Z' });
    assert.match(html, /4\.317/);
    assert.match(html, /389 different IPs/);
    assert.match(html, /up since 07:45/);
    assert.ok(!html.includes('Júri') && !html.includes('Jury'));
  });
});

describe('linha "a pensar"', () => {
  it('mostra o texto do último pensar do ciclo e tira-o da lista', () => {
    const ev = [
      { hora: '2026-11-20T10:00:00Z', pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
      { hora: '2026-11-20T10:00:01Z', pedidoId: '-', tipo: 'pensar', quem: 'atacante', depois: { passo: 'atacar', texto: 'A olhar para as portas da máquina nova' } },
      { hora: '2026-11-20T10:00:02Z', pedidoId: '-', tipo: 'pensar', quem: 'defesa', depois: { passo: 'defender', texto: 'A ver que regra deixa isto aberto' } },
    ];
    const html = renderizar([], ev);
    assert.match(html, /class="agora ag-defesa"><span>DEFESA · a pensar<\/span>A ver que regra deixa isto aberto/);
    assert.ok(!html.includes('A olhar para as portas'));
  });
});

describe('terminal (reconstruído da auditoria)', () => {
  const inv = { tipo: 'criar_regra', securityGroupId: 'b5e1687e-3f24', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;
  const regra = { id: '7c2462c8-6c2a', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
  const ev = [
    { hora: '2026-11-20T11:41:00Z', pedidoId: 'm', tipo: 'pedido', quem: 'migrador', depois: { servicos: ['s3', 'postgres'], plano: '...' } },
    { hora: '2026-11-20T11:41:01Z', pedidoId: 'm2', tipo: 'aprovado', quem: 'migrador', depois: { pelo: 'm' } },
    { hora: '2026-11-20T11:41:05Z', pedidoId: 'm', tipo: 'feito', quem: 'migrador', depois: { passo: 's3', objetos: 1540, checksumsOk: true, testes: { antes: true, depois: true } } },
    { hora: '2026-11-20T11:41:06Z', pedidoId: 'm', tipo: 'feito', quem: 'migrador', depois: { passo: 'segredos', segredos: 16, checksumsOk: true } },
    { hora: '2026-11-20T11:41:07Z', pedidoId: '-', tipo: 'pensar', quem: 'atacante', depois: { texto: 'x' } },
    { hora: '2026-11-20T11:54:30Z', pedidoId: '-', tipo: 'reconhecimento', quem: 'atacante', depois: { alvos: ['198.51.100.7'], portas: [{ alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }] } },
    { hora: '2026-11-20T11:54:38Z', pedidoId: 'p', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'antes', estado: 'open' } },
    { hora: '2026-11-20T11:54:38Z', pedidoId: 'p', tipo: 'a-aplicar', quem: 'defesa', antes: regra, inverso: inv },
    { hora: '2026-11-20T11:54:46Z', pedidoId: 'p', tipo: 'feito', quem: 'defesa', inverso: inv, confirmacao: 'de-fora' },
    { hora: '2026-11-20T11:54:49Z', pedidoId: 'p', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'depois', estado: 'filtered' } },
  ];

  it('cada evento vira o comando e o resultado medido; pensar e aprovações do plano não entram', async () => {
    const { linhasTerminal } = await import('@mwbe/painel');
    const l = linhasTerminal(ev as never);
    assert.deepEqual(
      l.map((x) => x.comando ?? x.saida[0].texto),
      [
        'analisar exemplo-app',
        'migrar s3 → minio',
        'migrar secrets-manager → openbao',
        'nmap -Pn -p 5432 198.51.100.7',
        'nmap -Pn -p 5432 198.51.100.7',
        'leaseweb revokeFirewallRules sg=b5e1687e regra=7c2462c8',
        '✓ regra removida · confirmado de fora (nmap) · inverso guardado',
        'nmap -Pn -p 5432 198.51.100.7',
      ],
    );
    assert.equal(l[1].saida[0].texto, '1.540 objetos copiados · sha256 ✓');
    assert.equal(l[2].saida[0].texto, '16 segredos (valores nunca mostrados) · sha256 ✓');
    assert.deepEqual([l[3].saida[0].texto, l[3].saida[0].tom], ['5432/tcp open postgresql', 'mau']);
    assert.deepEqual([l[7].saida[0].texto, l[7].saida[0].tom], ['5432/tcp filtered', 'ok']);
  });

  it('aparece no ecrã da demo, escapado', () => {
    const html = renderizar([], ev as never);
    assert.match(html, /TERMINAL/);
    assert.match(html, /defesa\$<\/span> leaseweb revokeFirewallRules/);
    assert.match(html, /5432\/tcp filtered/);
  });
});
