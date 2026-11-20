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
