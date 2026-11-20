import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  botoesPara,
  MODELOS,
  msgAbertura,
  msgAtacanteConfirma,
  msgAtaque,
  msgCodigo,
  msgDefesa,
  msgFechado,
  msgFimRelatorio,
  msgMigracao,
  msgPlano,
  msgPlanoAprovado,
  msgValidacao,
  NAO_MEDIDO,
  PENSAR,
  preencher,
  RESPOSTAS_FIXAS,
  type PassoDemo,
} from './mensagens';
import type { Regra } from './tipos';

const regra: Regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };

/** Todas as mensagens com todos os valores e sem nenhum. */
function todas(comValores: boolean): string[] {
  const v = <T>(x: T) => (comValores ? x : undefined);
  return [
    msgAbertura({ app: v('orders') }),
    msgPlano({ servicos: v([{ servico: 'S3', destino: 'MinIO', selfOuGerido: 'self-hosted' as const }]), ramLivreGb: v(8), motivoRegra: v('It fits on the VM.') }),
    msgPlanoAprovado({ quem: v('Ana'), hora: v('14:02') }),
    msgMigracao({ nObjetos: v(120), okS3: v(true), nLinhas: v(5000), okBd: v(true), okAntes: v(true), okDepois: v(true) }),
    msgAtaque({ porta: v(5432), gravidade: v('high') }),
    msgDefesa(),
    msgFechado({ horaFecho: v('14:05'), segundos: v(42), pedidoId: v('p-1') }),
    msgAtacanteConfirma(),
    msgCodigo({ numero: v(7), nFicheiros: v(3) }),
    msgValidacao({ testes: v(true), nadaExposto: v(true), dadosIguais: v(true) }),
    msgFimRelatorio({ minutos: v(12), nFalhas: v(1) }),
    ...Object.values(RESPOSTAS_FIXAS),
  ];
}

describe('shared/mensagens', () => {
  it('PENSAR: uma linha fixa por passo, com o agente certo, em inglês', () => {
    const passos: PassoDemo[] = ['abertura', 'plano', 'confirmacao', 'migrar', 'atacar', 'defender', 'codigo', 'validar', 'relatorio'];
    assert.deepEqual(Object.keys(PENSAR), passos);
    assert.deepEqual(
      passos.map((p) => PENSAR[p].agente),
      ['chefe', 'migrador', 'chefe', 'migrador', 'atacante', 'defesa', 'migrador', 'chefe', 'chefe'],
    );
    assert.equal(PENSAR.defender.texto, 'Explaining the risk and preparing a reversible fix.');
    assert.ok(Object.values(PENSAR).every((p) => /^[A-Z].*\.$/.test(p.texto) && !/\d/.test(p.texto)));
  });

  it('preencher: sem valor -> "not measured"; boolean -> ✓/✗; número com ponto', () => {
    assert.equal(NAO_MEDIDO, 'not measured');
    assert.equal(preencher('{a}|{b}|{c}|{d}|{e}|{f}', { a: 'x', b: true, c: false, d: 3.5, e: '' }), `x|✓|✗|3.5|${NAO_MEDIDO}|${NAO_MEDIDO}`);
    assert.equal(preencher('{x}', { x: Number.NaN }), NAO_MEDIDO);
    assert.equal(preencher('{toString}', {}), NAO_MEDIDO); // não lê propriedades herdadas
  });

  it('nenhuma mensagem fica com {variáveis} por preencher, com ou sem valores', () => {
    for (const m of [...todas(true), ...todas(false)]) assert.doesNotMatch(m, /\{[a-z_]+\}/i, m);
  });

  it('sem valores medidos, cada variável sai como "not measured" (nada inventado)', () => {
    assert.equal(msgPlanoAprovado({}), `Plan approved by ${NAO_MEDIDO} at ${NAO_MEDIDO}. @migrator, go ahead.`);
    assert.equal(msgValidacao({}), `Final check: tests ${NAO_MEDIDO}, nothing exposed ${NAO_MEDIDO}, data identical ${NAO_MEDIDO}.`);
    assert.match(msgMigracao({ nObjetos: 0, okS3: false }), /Files: 0 copied · checksum ✗\n· Database: not measured rows/);
  });

  it('textos em inglês, com a estrutura do mensagens-demo.md', () => {
    assert.equal(msgAbertura({ app: 'orders' }), 'Good morning. We are moving the orders app from AWS to Leaseweb, safely. I will report at every step.');
    assert.equal(
      msgMigracao({ nObjetos: 120, okS3: true, nLinhas: 5000, okBd: true, okAntes: true, okDepois: true }),
      'Migration complete.\n· Files: 120 copied · checksum ✓\n· Database: 5000 rows · checksum ✓\n· App tests: before ✓ · after ✓\nThe new infrastructure is live. @attacker, your turn.',
    );
    assert.equal(
      msgAtaque({ porta: 5432, gravidade: 'high' }),
      'I found the new database open to the whole Internet (port 5432).\nSeverity: high. Anyone can try to get in.\n@defender',
    );
    assert.equal(
      msgFechado({ horaFecho: '14:05', segundos: 42, pedidoId: 'p-1' }),
      'Closed at 14:05 and confirmed. Time exposed: 42 s.\nUndo saved: /undo p-1\n@attacker, please confirm.',
    );
    assert.equal(msgValidacao({ testes: true, nadaExposto: true, dadosIguais: true }), 'Final check: tests ✓, nothing exposed ✓, data identical ✓.');
    assert.equal(msgAtacanteConfirma(), 'Confirmed. I can no longer reach it.');
  });

  it('plano: uma linha por serviço, com contagem e lista; "gerido" sai como "managed"', () => {
    const m = msgPlano({
      servicos: [
        { servico: 'S3', destino: 'MinIO', selfOuGerido: 'self-hosted' },
        { servico: 'SQS', destino: 'RabbitMQ', selfOuGerido: 'self-hosted' },
        { servico: 'RDS', destino: 'Scaleway DB-DEV-S', selfOuGerido: 'gerido' },
      ],
      ramLivreGb: 8,
      motivoRegra: 'The database is critical.',
    });
    assert.equal(
      m,
      'I found 3 AWS services in the app: S3, SQS, RDS.\nProposal:\n· S3 → MinIO (self-hosted)\n· SQS → RabbitMQ (self-hosted)\n· RDS → Scaleway DB-DEV-S (managed)\nThe VM has 8 GB free. The database is critical.',
    );
  });

  it('defesa: a IA só troca a explicação; a proposta fica fixa', () => {
    assert.equal(msgDefesa(), `${MODELOS.defesaExplicacao}\n${MODELOS.defesaProposta}`);
    assert.equal(msgDefesa({ explicacaoIA: '  AI text.  ' }), `AI text.\n${MODELOS.defesaProposta}`);
    assert.equal(msgDefesa({ explicacaoIA: '   ' }), msgDefesa());
  });

  it('código e relatório: url e certificado só se existirem', () => {
    assert.equal(msgCodigo({ numero: 7, nFicheiros: 3 }).split('\n').length, 3);
    assert.match(msgCodigo({ numero: 7, nFicheiros: 3, url: 'https://example.com/pr/7' }), /\nhttps:\/\/example\.com\/pr\/7$/);
    assert.equal(
      msgFimRelatorio({ minutos: 12, nFalhas: 1 }),
      'In 12 min we moved from AWS to Leaseweb, closed 1 issue(s) and fixed the cause in the code. Nothing left the EU.',
    );
    assert.match(msgFimRelatorio({ minutos: 12, nFalhas: 1, certificado: 'CERTIFICATE' }), /^CERTIFICATE\n\nIn 12 min/);
  });

  it('botões em inglês: Approve plan / Close / Approve PR, e Ignore', () => {
    assert.deepEqual(botoesPara({ tipo: 'migrar', passo: 's3' }), { aprovar: 'Approve plan', ignorar: 'Ignore' });
    assert.deepEqual(botoesPara({ tipo: 'remover_regra', securityGroupId: 'sg-1', regra }), { aprovar: 'Close', ignorar: 'Ignore' });
    assert.deepEqual(botoesPara({ tipo: 'aprovar_pr', repo: 'dono/app', numero: 7 }), { aprovar: 'Approve PR', ignorar: 'Ignore' });
  });

  it('nenhuma mensagem promete uma ação por mensagem', () => {
    const promessa = /\b(I will|I'll|I can|I am going to) (close|open|delete|migrate|undo|change|remove)\b/i;
    for (const m of [...todas(true), ...Object.values(PENSAR).map((p) => p.texto)]) assert.doesNotMatch(m, promessa, m);
  });

  it('respostas fixas em inglês', () => {
    assert.deepEqual(RESPOSTAS_FIXAS, {
      foraDoEstado: "I don't have that information. Type /status to see the current status.",
      pedidoIgnorado: 'OK, leaving it as it is. Your decision not to close it is logged.',
      erroApi: 'Leaseweb did not answer in time. I changed nothing. I will try again.',
    });
  });

  it('nada em português nas mensagens (a demo é em inglês)', () => {
    for (const m of [...todas(true), ...todas(false), ...Object.values(PENSAR).map((p) => p.texto)])
      assert.doesNotMatch(m, /\b(não|está|serviços|aberta|Fechado|Plano|Migração)\b/, m);
  });
});
