import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { carregarAllowlist } from '../alvos';
import { iniciarAtaque, type DependenciasAtaque } from '../index';

function preparar(opcoes: { allowlist?: string; bloqueioRecon?: Promise<void> } = {}) {
  const mensagens: string[] = [];
  const ordem: string[] = [];
  const allowlist = carregarAllowlist(opcoes.allowlist ?? '203.0.113.10');

  const deps: DependenciasAtaque = {
    bus: { enviar: (m) => mensagens.push(m.texto) },
    allowlist: () => allowlist,
    reconhecer: async (alvo) => {
      ordem.push('recon');
      if (opcoes.bloqueioRecon) await opcoes.bloqueioRecon;
      return [{ alvo, porta: 5432, estado: 'aberta' }];
    },
    forcaBruta: async (alvo, _allowlist, log) => {
      ordem.push('ssh');
      log(`tentativa 1/20 em ${alvo}, utilizador 'deploy'`);
      return { alvo, utilizador: 'deploy', tentativas: 2, sucesso: true, senha: 'deploy123' };
    },
    extras: async () => {
      ordem.push('extras');
      return [];
    },
    segredos: async () => {
      ordem.push('segredos');
      return [];
    },
  };

  return { deps, mensagens, ordem };
}

describe('atacante/iniciarAtaque', () => {
  it('recusa com a allowlist vazia e não contacta nada', async () => {
    const { deps, mensagens, ordem } = preparar({ allowlist: '' });
    const r = await iniciarAtaque({}, deps);
    assert.equal(r.estado, 'recusado');
    assert.ok(mensagens.includes('allowlist vazia, ataque recusado'));
    assert.deepEqual(ordem, []);
  });

  it('recusa um alvo fora da allowlist e não contacta nada', async () => {
    const { deps, mensagens, ordem } = preparar();
    const r = await iniciarAtaque({ alvo: '203.0.113.11' }, deps);
    assert.equal(r.estado, 'recusado');
    assert.ok(mensagens.some((m) => m.includes('fora da allowlist')));
    assert.deepEqual(ordem, []);
  });

  it('faz reconhecimento e SSH pela ordem certa, sem publicar a palavra-passe', async () => {
    const { deps, mensagens, ordem } = preparar();
    const r = await iniciarAtaque({ alvo: '203.0.113.10' }, deps);
    assert.equal(r.estado, 'feito');
    assert.deepEqual(ordem, ['recon', 'ssh']);
    assert.ok(mensagens.some((m) => m.startsWith('⚔️ Ataque iniciado')));
    assert.ok(mensagens.some((m) => m.startsWith('✅ SSH: entrei com deploy')));
    assert.ok(mensagens.includes('✅ Ataque terminado'));
    assert.ok(!mensagens.join('\n').includes('deploy123'));
  });

  it('não arranca um segundo ataque enquanto o primeiro decorre', async () => {
    let libertar!: () => void;
    const bloqueio = new Promise<void>((ok) => {
      libertar = ok;
    });
    const { deps, mensagens, ordem } = preparar({ bloqueioRecon: bloqueio });
    const primeiro = iniciarAtaque({ alvo: '203.0.113.10' }, deps);
    try {
      const segundo = await iniciarAtaque({ alvo: '203.0.113.10' }, deps);
      assert.equal(segundo.estado, 'em-curso');
      assert.ok(mensagens.includes('ataque já em curso'));
    } finally {
      libertar();
      await primeiro;
    }
    assert.deepEqual(ordem, ['recon', 'ssh']);
  });

  it('corre os extras no fim quando pedidos', async () => {
    const { deps, mensagens, ordem } = preparar();
    const r = await iniciarAtaque({ alvo: '203.0.113.10', extras: true }, deps);
    assert.equal(r.estado, 'feito');
    assert.deepEqual(ordem, ['recon', 'ssh', 'extras', 'segredos']);
    assert.ok(mensagens.some((m) => m.startsWith('🧪 Extras:')));
  });
});
