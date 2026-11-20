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
    assert.match(html, /exposto 38 s/);
    assert.match(renderizar([], ev.slice(0, 1)), /class="relogio exposta"/);
    assert.ok(!renderizar([], []).includes('class="relogio'));
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
