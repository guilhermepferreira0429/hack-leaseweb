// Start/Reset do painel e vista pública. Só as guardas: o caminho de sucesso arrancaria uma corrida a sério
// (npm run demo) ou reporia o repo da app e reabriria a 5432, por isso não se testa aqui.
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { estadoJsonSeguro, iniciarPainel, tarefaAtual } from '../servidor';
import { pedidoLocal, renderizarV2 } from '../v2';

const pedidoDe = (ip: string) => ({ socket: { remoteAddress: ip }, headers: {} }) as unknown as IncomingMessage;

describe('painel: Start e Reset', () => {
  it('POST /iniciar e /limpar recusam sem token, com token errado e com outra origem; GET dá 404', async () => {
    const tokenAntes = process.env.PAINEL_TOKEN;
    process.env.PAINEL_TOKEN = 'segredo-de-teste';
    const srv = iniciarPainel(0, { host: '127.0.0.1', desfazer: async () => {} });
    await new Promise((ok) => srv.once('listening', ok));
    const porta = (srv.address() as { port: number }).port;
    const post = (rota: string, corpo: string, origin?: string) =>
      fetch(`http://127.0.0.1:${porta}${rota}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) },
        body: corpo,
      });
    try {
      for (const rota of ['/iniciar', '/limpar']) {
        assert.equal((await post(rota, '')).status, 403, `${rota} sem token`);
        assert.equal((await post(rota, 'token=errado')).status, 403, `${rota} token errado`);
        assert.equal((await post(rota, 'token=segredo-de-teste', 'http://mau.example')).status, 403, `${rota} outra origem`);
        assert.equal((await fetch(`http://127.0.0.1:${porta}${rota}?token=segredo-de-teste`)).status, 404, `${rota} por GET`);
      }
      process.env.PAINEL_TOKEN = '';
      assert.equal((await post('/iniciar', 'token=')).status, 403, 'sem PAINEL_TOKEN no .env');
      assert.equal(tarefaAtual(), undefined, 'nada foi lançado');
    } finally {
      srv.close();
      process.env.PAINEL_TOKEN = tokenAntes;
    }
  });

  it('botões Start e Reset só com token; a correr, o Start fica desligado', () => {
    assert.doesNotMatch(renderizarV2([], [], {}), /action="\/(iniciar|limpar)"/);
    const comToken = renderizarV2([], [], { token: 'tk' });
    assert.match(comToken, /action="\/iniciar"/);
    assert.match(comToken, /action="\/limpar"/);
    const aCorrer = renderizarV2([], [], { token: 'tk', aCorrer: 'demo' });
    assert.match(aCorrer, /Running…/);
    assert.match(aCorrer, /disabled>▶ Start/);
  });
});

describe('painel: vista pública', () => {
  it('pedidoLocal: só loopback', () => {
    assert.equal(pedidoLocal(pedidoDe('127.0.0.1')), true);
    assert.equal(pedidoLocal(pedidoDe('::1')), true);
    assert.equal(pedidoLocal(pedidoDe('::ffff:127.0.0.1')), true);
    assert.equal(pedidoLocal(pedidoDe('203.0.113.7')), false);
  });

  it('/estado.json de fora devolve só versão e contagem, sem IPs nem ids de SG', async () => {
    let corpo = '';
    const res = {
      writeHead() {
        return this;
      },
      end(c: string) {
        corpo = c;
        return this;
      },
    } as unknown as ServerResponse;
    await estadoJsonSeguro(pedidoDe('203.0.113.7'), res);
    const json = JSON.parse(corpo) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json).sort(), ['aCorrer', 'eventos', 'versao']);
    assert.match(String(json.versao), /^[0-9a-f]{16}$/);
    assert.doesNotMatch(corpo, /\b\d{1,3}(\.\d{1,3}){3}\b|sg-/);
  });
});
