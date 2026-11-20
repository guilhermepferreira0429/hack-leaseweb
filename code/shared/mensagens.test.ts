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
    msgAbertura({ app: v('encomendas') }),
    msgPlano({ servicos: v([{ servico: 'S3', destino: 'MinIO', selfOuGerido: 'self-hosted' as const }]), ramLivreGb: v(8), motivoRegra: v('Cabe na VM.') }),
    msgPlanoAprovado({ quem: v('Ana'), hora: v('14:02') }),
    msgMigracao({ nObjetos: v(120), okS3: v(true), nLinhas: v(5000), okBd: v(true), okAntes: v(true), okDepois: v(true) }),
    msgAtaque({ porta: v(5432), gravidade: v('alta') }),
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
  it('PENSAR: uma linha fixa por passo, com o agente certo', () => {
    const passos: PassoDemo[] = ['abertura', 'plano', 'confirmacao', 'migrar', 'atacar', 'defender', 'codigo', 'validar', 'relatorio'];
    assert.deepEqual(Object.keys(PENSAR), passos);
    assert.deepEqual(
      passos.map((p) => PENSAR[p].agente),
      ['chefe', 'migrador', 'chefe', 'migrador', 'atacante', 'defesa', 'migrador', 'chefe', 'chefe'],
    );
    assert.equal(PENSAR.defender.texto, 'A explicar o risco e a preparar o fecho reversível.');
    assert.ok(Object.values(PENSAR).every((p) => /^[A-ZÀ].*\.$/.test(p.texto) && !/\d/.test(p.texto)));
  });

  it('preencher: sem valor -> "não medido"; boolean -> ✓/✗; número com vírgula', () => {
    assert.equal(preencher('{a}|{b}|{c}|{d}|{e}|{f}', { a: 'x', b: true, c: false, d: 3.5, e: '' }), `x|✓|✗|3,5|${NAO_MEDIDO}|${NAO_MEDIDO}`);
    assert.equal(preencher('{x}', { x: Number.NaN }), NAO_MEDIDO);
    assert.equal(preencher('{toString}', {}), NAO_MEDIDO); // não lê propriedades herdadas
  });

  it('nenhuma mensagem fica com {variáveis} por preencher, com ou sem valores', () => {
    for (const m of [...todas(true), ...todas(false)]) assert.doesNotMatch(m, /\{[a-z_]+\}/i, m);
  });

  it('sem valores medidos, cada variável sai como "não medido" (nada inventado)', () => {
    assert.equal(msgPlanoAprovado({}), `Plano aprovado por ${NAO_MEDIDO} às ${NAO_MEDIDO}. @migrador, avança.`);
    assert.equal(msgValidacao({}), `Validação final: testes ${NAO_MEDIDO}, nada exposto ${NAO_MEDIDO}, dados iguais ${NAO_MEDIDO}.`);
    assert.match(msgMigracao({ nObjetos: 0, okS3: false }), /Ficheiros: 0 copiados · checksum ✗\n· Base de dados: não medido linhas/);
  });

  it('textos iguais ao mensagens-demo.md', () => {
    assert.equal(msgAbertura({ app: 'encomendas' }), 'Bom dia. Vamos tirar a app encomendas da AWS e trazê-la para a Leaseweb, com segurança. Eu aviso em cada passo.');
    assert.equal(
      msgMigracao({ nObjetos: 120, okS3: true, nLinhas: 5000, okBd: true, okAntes: true, okDepois: true }),
      'Migração concluída.\n· Ficheiros: 120 copiados · checksum ✓\n· Base de dados: 5000 linhas · checksum ✓\n· Testes da app: antes ✓ · depois ✓\nA infraestrutura nova está no ar. @atacante, a tua vez.',
    );
    assert.equal(
      msgAtaque({ porta: 5432, gravidade: 'alta' }),
      'Encontrei a base de dados nova aberta a toda a Internet (porta 5432).\nGravidade: alta. Qualquer pessoa pode tentar entrar.\n@defesa',
    );
    assert.equal(
      msgFechado({ horaFecho: '14:05', segundos: 42, pedidoId: 'p-1' }),
      'Fechado às 14:05 e confirmado. Tempo exposto: 42 s.\nGuardei como voltar atrás: /desfazer p-1\n@atacante, confirma.',
    );
    assert.equal(msgValidacao({ testes: true, nadaExposto: true, dadosIguais: true }), 'Validação final: testes ✓, nada exposto ✓, dados iguais ✓.');
    assert.equal(msgAtacanteConfirma(), 'Confirmo. Já não chego lá.');
  });

  it('plano: uma linha por serviço, com contagem e lista', () => {
    const m = msgPlano({
      servicos: [
        { servico: 'S3', destino: 'MinIO', selfOuGerido: 'self-hosted' },
        { servico: 'SQS', destino: 'RabbitMQ', selfOuGerido: 'self-hosted' },
        { servico: 'RDS', destino: 'Scaleway DB-DEV-S', selfOuGerido: 'gerido' },
      ],
      ramLivreGb: 8,
      motivoRegra: 'A base de dados é crítica.',
    });
    assert.equal(
      m,
      'Encontrei 3 serviços da AWS na app: S3, SQS, RDS.\nProposta:\n· S3 → MinIO (self-hosted)\n· SQS → RabbitMQ (self-hosted)\n· RDS → Scaleway DB-DEV-S (gerido)\nA VM tem 8 GB livres. A base de dados é crítica.',
    );
  });

  it('defesa: a IA só troca a explicação; a proposta fica fixa', () => {
    assert.equal(msgDefesa(), `${MODELOS.defesaExplicacao}\n${MODELOS.defesaProposta}`);
    assert.equal(msgDefesa({ explicacaoIA: '  Texto da IA.  ' }), `Texto da IA.\n${MODELOS.defesaProposta}`);
    assert.equal(msgDefesa({ explicacaoIA: '   ' }), msgDefesa());
  });

  it('código e relatório: url e certificado só se existirem', () => {
    assert.equal(msgCodigo({ numero: 7, nFicheiros: 3 }).split('\n').length, 3);
    assert.match(msgCodigo({ numero: 7, nFicheiros: 3, url: 'https://example.com/pr/7' }), /\nhttps:\/\/example\.com\/pr\/7$/);
    assert.equal(
      msgFimRelatorio({ minutos: 12, nFalhas: 1 }),
      'Em 12 min saímos da AWS para a Leaseweb, fechámos 1 falha(s) e corrigimos a causa no código. Nada saiu da UE.',
    );
    assert.match(msgFimRelatorio({ minutos: 12, nFalhas: 1, certificado: 'CERTIFICADO' }), /^CERTIFICADO\n\nEm 12 min/);
  });

  it('botões: migrar -> Aprovar plano / Ignorar; remover_regra -> Fechar / Ignorar', () => {
    assert.deepEqual(botoesPara({ tipo: 'migrar', passo: 's3' }), { aprovar: 'Aprovar plano', ignorar: 'Ignorar' });
    assert.deepEqual(botoesPara({ tipo: 'remover_regra', securityGroupId: 'sg-1', regra }), { aprovar: 'Fechar', ignorar: 'Ignorar' });
  });

  it('nenhuma mensagem promete uma ação por mensagem', () => {
    const promessa = /\b(vou|irei|posso) (fechar|abrir|apagar|migrar|desfazer|alterar|mudar|remover)\b/i;
    for (const m of [...todas(true), ...Object.values(PENSAR).map((p) => p.texto)]) assert.doesNotMatch(m, promessa, m);
  });

  it('respostas fixas iguais ao doc', () => {
    assert.deepEqual(RESPOSTAS_FIXAS, {
      foraDoEstado: 'Não tenho essa informação. Escreva /estado para ver o ponto da situação.',
      pedidoIgnorado: 'Ok, fica como está. Fica registado que decidiu não fechar.',
      erroApi: 'A Leaseweb não respondeu a tempo. Não mudei nada. Vou tentar outra vez.',
    });
  });
});
