import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlvoRecusadoError, carregarAllowlist } from '../alvos';
import { avaliarResposta, verificarHttp } from '../http';

const ALVO = '203.0.113.10';

describe('atacante/http', () => {
  it('HTTP sem redirecionar para HTTPS é gravidade alta', () => {
    const achados = avaliarResposta(ALVO, { porta: 80, estado: 200, cabecalhos: {}, https: false });
    assert.equal(achados.length, 1);
    assert.equal(achados[0]!.severidade, 'alta');
    assert.match(achados[0]!.detalhe, /sem redirecionar/);
  });

  it('HTTP que redireciona para HTTPS não é achado', () => {
    const achados = avaliarResposta(ALVO, {
      porta: 80,
      estado: 301,
      cabecalhos: { location: 'https://exemplo' },
      https: false,
    });
    assert.deepEqual(achados, []);
  });

  it('HTTPS com certificado inválido e cabeçalhos em falta', () => {
    const achados = avaliarResposta(ALVO, { porta: 443, estado: 200, cabecalhos: {}, https: true, autorizado: false });
    const ids = achados.map((a) => a.id);
    assert.ok(ids.some((id) => id.endsWith('-certificado')));
    assert.ok(ids.some((id) => id.endsWith('-hsts')));
    assert.ok(ids.some((id) => id.endsWith('-cabecalhos')));
    assert.ok(achados.every((a) => a.alvo === ALVO));
  });

  it('HTTPS válido e com todos os cabeçalhos não é achado', () => {
    const achados = avaliarResposta(ALVO, {
      porta: 443,
      estado: 200,
      protocolo: 'TLSv1.3',
      cabecalhos: {
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
      https: true,
      autorizado: true,
    });
    assert.deepEqual(achados, []);
  });

  it('TLS antigo é gravidade alta', () => {
    const achados = avaliarResposta(ALVO, {
      porta: 443,
      estado: 200,
      protocolo: 'TLSv1.1',
      cabecalhos: {
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
      https: true,
      autorizado: true,
    });
    assert.equal(achados.length, 1);
    assert.match(achados[0]!.id, /-tls-antigo$/);
    assert.equal(achados[0]!.severidade, 'alta');
  });

  it('recusa o alvo fora da allowlist antes de qualquer ligação', async () => {
    await assert.rejects(verificarHttp('203.0.113.11', carregarAllowlist(ALVO)), AlvoRecusadoError);
  });
});
