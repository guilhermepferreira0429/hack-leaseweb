import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  normalizarAdminIp,
  PORTAS_SENSIVEIS,
  POR_ESCOLHER,
  resumoPlano,
  traduzir,
  type ItemRecusar,
  type PlanoTraducao,
  type TerraformJson,
} from './index';

// Os valores secretos nunca aparecem neste ficheiro: os do exemplo leem-se do main.tf.json em tempo de execução
// e os outros são gerados ao acaso. As mensagens de erro dos testes também não os levam.
const EXEMPLO = readFileSync(new URL('./exemplo/main.tf.json', import.meta.url), 'utf8');
const ADMIN = '203.0.113.10';

const exemplo = (adminIp = ADMIN) => traduzir(EXEMPLO, { adminIp });

type Regra = { protocol: string; startPort?: number; endPort?: number; source: string };
const regras = (p: PlanoTraducao): Regra[] =>
  p.criar.filter((c) => c.acao === 'autorizar-regras').flatMap((c) => c.pedido.corpo.rules as Regra[]);
const portas = (p: PlanoTraducao) => p.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'porta-aberta' }> => r.tipo === 'porta-aberta');
const segredos = (p: PlanoTraducao) => p.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'segredo' }> => r.tipo === 'segredo');
const assuntos = (p: PlanoTraducao) => p.sinalizar.map((s) => `${s.origem}:${s.assunto}`);

/** Terraform mínimo com um grupo e uma instância, para os casos isolados. */
function tfCom(extra: { ingress?: unknown[]; instancia?: Record<string, unknown>; recursos?: Record<string, unknown>; regiao?: string } = {}): TerraformJson {
  return {
    provider: { aws: { region: extra.regiao ?? 'eu-west-1' } },
    data: { aws_ami: { u: { owners: ['099720109477'], filter: [{ name: 'name', values: ['ubuntu/images/ubuntu-jammy-22.04-amd64-server-*'] }] } } },
    resource: {
      aws_security_group: { sg: { name: 'sg', ingress: extra.ingress ?? [] } },
      aws_instance: {
        vm: { ami: '${data.aws_ami.u.id}', instance_type: 'm5.large', vpc_security_group_ids: ['${aws_security_group.sg.id}'], ...extra.instancia },
      },
      ...extra.recursos,
    },
  };
}
const aberta = (porta: number, cidr = '0.0.0.0/0', protocol = 'tcp') => ({ from_port: porta, to_port: porta, protocol, cidr_blocks: [cidr] });

/** Procura um valor num texto sem nunca o pôr na mensagem de erro. */
function semValor(textoPlano: string, valor: string, onde: string) {
  assert.ok(valor.length >= 4, `valor de teste demasiado curto (${onde})`);
  assert.ok(!textoPlano.includes(valor), `um valor secreto apareceu em: ${onde}`);
}

describe('tradutor: instância', () => {
  it('m5.large Ubuntu 22.04 eu-west-1 -> POST /instances com lsw.m5.large, UBUNTU_22_04_64BIT, eu-west-3', () => {
    const inst = exemplo().criar.find((c) => c.acao === 'criar-instancia')!;
    assert.deepEqual(inst.pedido, {
      metodo: 'POST',
      caminho: '/instances',
      corpo: {
        region: 'eu-west-3',
        type: 'lsw.m5.large',
        imageId: 'UBUNTU_22_04_64BIT',
        contractType: 'HOURLY',
        rootDiskSize: 30,
        rootDiskStorageType: 'CENTRAL',
        reference: 'web',
      },
    });
    assert.ok(inst.notas.some((n) => n.includes('GET /instanceTypes')));
    assert.ok(inst.notas.some((n) => n.includes('GET /images')));
  });

  it('ordem dos pedidos: grupo, regras, instância, ligar grupos', () => {
    assert.deepEqual(
      exemplo().criar.map((c) => `${c.pedido.metodo} ${c.pedido.caminho}`),
      [
        'POST /securityGroups',
        'POST /securityGroups/{securityGroupId:aws_security_group.web}/authorizeFirewallRules',
        'POST /instances',
        'POST /instances/{instanceId:aws_instance.web}/attachSecurityGroups',
      ],
    );
  });

  it('tipo fora da tabela -> lsw.<tipo> e sinalizado', () => {
    const p = traduzir(tfCom({ instancia: { instance_type: 'x9.mega' } }), { adminIp: ADMIN });
    assert.equal(p.criar.find((c) => c.acao === 'criar-instancia')!.pedido.corpo.type, 'lsw.x9.mega');
    assert.ok(assuntos(p).includes('aws_instance.vm:tipo'));
  });

  it('AMI pelo id ou própria (owners self) -> imagem por escolher e sinalizada', () => {
    for (const p of [
      traduzir(tfCom({ instancia: { ami: 'ami-0123456789abcdef0' } }), { adminIp: ADMIN }),
      traduzir({ ...tfCom(), data: { aws_ami: { u: { owners: ['self'], name_regex: 'ubuntu-22.04-minha' } } } }, { adminIp: ADMIN }),
    ]) {
      assert.equal(p.criar.find((c) => c.acao === 'criar-instancia')!.pedido.corpo.imageId, POR_ESCOLHER);
      assert.ok(assuntos(p).includes('aws_instance.vm:ami-custom'));
    }
  });

  it('região fora da UE (us-east-1, Londres) -> sinalizada; destino sempre eu-west-3', () => {
    for (const regiao of ['us-east-1', 'eu-west-2']) {
      const p = traduzir(tfCom({ regiao }), { adminIp: ADMIN });
      assert.equal(p.regiaoOrigem, regiao);
      assert.ok(p.sinalizar.some((s) => s.assunto === 'regiao'));
      assert.equal(p.criar.find((c) => c.acao === 'criar-instancia')!.pedido.corpo.region, 'eu-west-3');
    }
    assert.ok(!exemplo().sinalizar.some((s) => s.assunto === 'regiao'));
  });

  it('zona da instância manda sobre a região do provider', () => {
    const p = traduzir(tfCom({ instancia: { availability_zone: 'us-west-2b' } }), { adminIp: ADMIN });
    assert.equal(p.regiaoOrigem, 'eu-west-1');
    assert.ok(assuntos(p).includes('aws_instance.vm:regiao'));
  });
});

describe('tradutor: grupos de segurança e porta de segurança', () => {
  it('exemplo: 80/443 abertos, 22 só ADMIN_IP, 5432 não existe', () => {
    const p = exemplo();
    assert.deepEqual(p.criar[0]!.pedido, { metodo: 'POST', caminho: '/securityGroups', corpo: { name: 'encomendas-web' } });
    assert.deepEqual(regras(p), [
      { protocol: 'TCP', startPort: 22, endPort: 22, source: `${ADMIN}/32` },
      { protocol: 'TCP', startPort: 80, endPort: 80, source: '0.0.0.0/0' },
      { protocol: 'TCP', startPort: 443, endPort: 443, source: '0.0.0.0/0' },
    ]);
    assert.deepEqual(
      portas(p).map((r) => [r.inicio, r.destino]),
      [
        [22, 'so-admin'],
        [5432, 'nao-existe'],
      ],
    );
  });

  it('sem ADMIN_IP: o 22 não é criado e fica recusado à espera do ADMIN_IP', () => {
    const p = exemplo('');
    assert.ok(!regras(p).some((r) => r.startPort === 22));
    assert.equal(portas(p).find((r) => r.inicio === 22)!.destino, 'admin-ip-em-falta');
  });

  it('cada porta sensível aberta ao mundo (IPv4 e IPv6) nunca é copiada com 0.0.0.0/0 ou ::/0', () => {
    for (const porta of Object.keys(PORTAS_SENSIVEIS).map(Number)) {
      for (const cidr of ['0.0.0.0/0', '::/0']) {
        const p = traduzir(tfCom({ ingress: [aberta(porta, cidr)] }), { adminIp: ADMIN });
        assert.ok(!regras(p).some((r) => r.source === cidr), `porta ${porta} ${cidr} copiada`);
        const recusa = portas(p)[0]!;
        assert.deepEqual(recusa.portasSensiveis, [porta]);
        assert.equal(recusa.destino, porta === 22 || porta === 3389 ? 'so-admin' : 'nao-existe');
      }
    }
  });

  it('intervalo ou "todo o tráfego" ao mundo com portas sensíveis -> recusado inteiro', () => {
    const p = traduzir(
      tfCom({ ingress: [{ from_port: 5000, to_port: 6000, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] }, { from_port: 0, to_port: 0, protocol: '-1', cidr_blocks: ['0.0.0.0/0'] }] }),
      { adminIp: ADMIN },
    );
    assert.deepEqual(regras(p), []);
    assert.deepEqual(portas(p)[0]!.portasSensiveis, [5432, 5984]);
    assert.ok(portas(p).slice(1).every((r) => r.destino === 'nao-existe' && r.portasSensiveis.length === Object.keys(PORTAS_SENSIVEIS).length));
  });

  it('revisão 1: origem por variável resolve-se; 0.0.0.0/0 escondido numa variável é recusado na mesma', () => {
    const tf = { ...tfCom({ ingress: [{ from_port: 5432, to_port: 5432, protocol: 'tcp', cidr_blocks: ['${var.aberto}'] }] }), variable: { aberto: { default: '0.0.0.0/0' } } };
    const p = traduzir(tf, { adminIp: ADMIN });
    assert.deepEqual(regras(p), []);
    assert.deepEqual(portas(p).map((r) => [r.inicio, r.fonte, r.destino]), [[5432, '0.0.0.0/0', 'nao-existe']]);
  });

  it('revisão 1: origem que não se resolve num CIDR -> sinalizada e sem regra (falha fechado)', () => {
    for (const fonte of ['${var.sem_valor}', '${local.rede}', 'qualquer-coisa']) {
      const p = traduzir(tfCom({ ingress: [{ from_port: 80, to_port: 80, protocol: 'tcp', cidr_blocks: [fonte] }] }), { adminIp: ADMIN });
      assert.deepEqual(regras(p), [], `regra criada com ${fonte}`);
      assert.ok(p.sinalizar.some((s) => s.titulo === `origem ${fonte} por resolver`));
    }
  });

  it('revisão 2: cidr_blocks como referência a uma lista resolve-se; sem valor -> sinalizado', () => {
    const comLista = { ...tfCom({ ingress: [{ from_port: 5432, to_port: 5432, protocol: 'tcp', cidr_blocks: '${var.lista}' }] }), variable: { lista: { default: ['0.0.0.0/0', '198.51.100.0/24'] } } };
    const p = traduzir(comLista, { adminIp: ADMIN });
    assert.deepEqual(regras(p), [{ protocol: 'TCP', startPort: 5432, endPort: 5432, source: '198.51.100.0/24' }]);
    assert.deepEqual(portas(p).map((r) => r.fonte), ['0.0.0.0/0']);

    const semValor = traduzir(tfCom({ ingress: [{ from_port: 443, to_port: 443, protocol: 'tcp', cidr_blocks: '${var.lista}' }] }), { adminIp: ADMIN });
    assert.deepEqual(regras(semValor), []);
    assert.ok(semValor.sinalizar.some((s) => s.titulo === 'origem ${var.lista} por resolver'));
  });

  it('revisão 3: CouchDB (5984) é porta sensível, como em docs/arquitetura.md e defesa/detetar.ts', () => {
    assert.equal(PORTAS_SENSIVEIS[5984], 'CouchDB');
    assert.deepEqual(Object.keys(PORTAS_SENSIVEIS).map(Number).sort((a, b) => a - b), [22, 23, 445, 1433, 3306, 3389, 5432, 5984, 6379, 9200, 27017]);
    const p = traduzir(tfCom({ ingress: [aberta(5984)] }), { adminIp: ADMIN });
    assert.deepEqual(regras(p), []);
    assert.equal(portas(p)[0]!.destino, 'nao-existe');
  });

  it('revisão 4: 1-65535 ao mundo é recusado inteiro e o porquê diz que as portas web também ficam de fora', () => {
    const p = traduzir(tfCom({ ingress: [{ from_port: 1, to_port: 65535, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] }] }), { adminIp: ADMIN });
    assert.deepEqual(regras(p), []);
    assert.match(portas(p)[0]!.porque, /também as web, 80 e 443\) ficam de fora; recria à parte/);
    assert.ok(resumoPlano(p).length <= 600);
  });

  it('porta sensível só para uma rede privada -> copiada tal e qual, com aviso de rede', () => {
    const p = traduzir(tfCom({ ingress: [aberta(5432, '10.0.0.0/16')] }), { adminIp: ADMIN });
    assert.deepEqual(regras(p), [{ protocol: 'TCP', startPort: 5432, endPort: 5432, source: '10.0.0.0/16' }]);
    assert.deepEqual(portas(p), []);
    assert.ok(assuntos(p).includes('aws_security_group.sg:rede'));
  });

  it('egress -> sinalizado, nunca vira regra', () => {
    const p = exemplo();
    assert.ok(assuntos(p).includes('aws_security_group.web:egress'));
    assert.equal(regras(p).length, 3);
  });

  it('aws_security_group_rule separado entra no grupo certo', () => {
    const tf = tfCom({
      recursos: {
        aws_security_group_rule: {
          ssh: { type: 'ingress', security_group_id: '${aws_security_group.sg.id}', ...aberta(22) },
          web: { type: 'ingress', security_group_id: '${aws_security_group.sg.id}', ...aberta(443) },
          saida: { type: 'egress', security_group_id: '${aws_security_group.sg.id}', ...aberta(0) },
        },
      },
    });
    const p = traduzir(tf, { adminIp: ADMIN });
    assert.deepEqual(regras(p), [
      { protocol: 'TCP', startPort: 22, endPort: 22, source: `${ADMIN}/32` },
      { protocol: 'TCP', startPort: 443, endPort: 443, source: '0.0.0.0/0' },
    ]);
    assert.ok(assuntos(p).includes('aws_security_group_rule.saida:egress'));
  });

  it('ADMIN_IP: aceita IP ou /24+, recusa 0.0.0.0/0, redes largas e lixo', () => {
    assert.deepEqual(normalizarAdminIp('203.0.113.10'), { cidr: '203.0.113.10/32' });
    assert.deepEqual(normalizarAdminIp(' 203.0.113.0/24 '), { cidr: '203.0.113.0/24' });
    assert.deepEqual(normalizarAdminIp(''), {});
    for (const mau of ['0.0.0.0/0', '10.0.0.0/8', '999.1.1.1', 'abc', '::/0'])
      assert.ok(normalizarAdminIp(mau).problema, `aceitou ${mau}`);
    const p = traduzir(tfCom({ ingress: [aberta(22)] }), { adminIp: '0.0.0.0/0' });
    assert.ok(!regras(p).some((r) => r.startPort === 22));
    assert.ok(p.sinalizar.some((s) => s.assunto === 'admin-ip'));
  });
});

describe('tradutor: substituir e sinalizar', () => {
  it('S3 -> MinIO, SQS -> RabbitMQ, RDS postgres -> PostgreSQL, com "como se move"', () => {
    const p = exemplo();
    assert.deepEqual(
      p.substituir.map((s) => [s.origem, s.servicoAws, s.alternativa.split(' ')[0], s.nivel]),
      [
        ['aws_s3_bucket.ficheiros', 'S3', 'MinIO', 'A'],
        ['aws_sqs_queue.encomendas', 'SQS', 'RabbitMQ', 'B'],
        ['aws_db_instance.encomendas', 'RDS PostgreSQL', 'PostgreSQL', 'B'],
      ],
    );
    assert.ok(p.substituir.every((s) => s.comoSeMove.length > 20));
  });

  it('RDS mysql -> MariaDB; motor sem alternativa (oracle) -> sinalizado', () => {
    const p = traduzir(
      tfCom({ recursos: { aws_db_instance: { a: { engine: 'mysql' }, b: { engine: 'oracle-se2', publicly_accessible: true } } } }),
      { adminIp: ADMIN },
    );
    assert.deepEqual(p.substituir.map((s) => s.servicoAws), ['RDS MySQL']);
    assert.ok(assuntos(p).includes('aws_db_instance.b:lock-in'));
  });

  it('IAM e Lambda -> sinalizados com o porquê; nada é criado para eles', () => {
    const p = exemplo();
    const iam = p.sinalizar.find((s) => s.origem === 'aws_iam_user.deploy')!;
    const lambda = p.sinalizar.find((s) => s.origem === 'aws_lambda_function.miniaturas')!;
    assert.equal(iam.assunto, 'iam');
    assert.equal(lambda.assunto, 'lock-in');
    assert.ok(iam.porque && lambda.porque && iam.oQueFazer && lambda.oQueFazer);
    assert.ok(!p.criar.some((c) => c.origem.startsWith('aws_iam') || c.origem.startsWith('aws_lambda')));
  });

  it('ElastiCache -> Valkey (cluster e grupo de replicação); Secrets Manager -> OpenBao, valor nunca copiado', () => {
    const segredo = `Fict${randomUUID()}`;
    const p = traduzir(
      tfCom({
        recursos: {
          aws_elasticache_cluster: { cache: { engine: 'redis' } },
          aws_elasticache_replication_group: { rg: { description: 'sessões' } },
          aws_secretsmanager_secret: { db: { name: 'db' } },
          aws_secretsmanager_secret_version: { db: { secret_id: '${aws_secretsmanager_secret.db.id}', secret_string: segredo } },
        },
      }),
      { adminIp: ADMIN },
    );
    assert.deepEqual(
      p.substituir.map((s) => [s.origem, s.alternativa.split(' ')[0]]),
      [
        ['aws_elasticache_cluster.cache', 'Valkey'],
        ['aws_elasticache_replication_group.rg', 'Valkey'],
        ['aws_secretsmanager_secret.db', 'OpenBao'],
      ],
    );
    assert.ok(assuntos(p).includes('aws_secretsmanager_secret_version.db:segredo'));
    assert.deepEqual(segredos(p).map((s) => [s.origem, s.nome]), [['aws_secretsmanager_secret_version.db', 'secret_string']]);
    semValor(JSON.stringify(p), segredo, 'plano');
    semValor(resumoPlano(p), segredo, 'resumo');
  });

  it('recurso desconhecido -> sinalizado para revisão humana', () => {
    const p = traduzir(tfCom({ recursos: { aws_glue_job: { x: {} } } }), { adminIp: ADMIN });
    assert.ok(assuntos(p).includes('aws_glue_job.x:desconhecido'));
  });

  it('chave SSH da AWS e PasswordAuthentication yes -> sinalizados', () => {
    const p = traduzir(
      tfCom({ instancia: { key_name: 'k', user_data: '#!/bin/bash\necho "PasswordAuthentication yes" >> /etc/ssh/sshd_config\n' } }),
      { adminIp: ADMIN },
    );
    assert.ok(p.sinalizar.some((s) => s.assunto === 'ssh' && s.titulo === 'chave SSH k'));
    assert.ok(p.sinalizar.some((s) => s.assunto === 'ssh' && s.porque.includes('linha 2')));
  });
});

describe('tradutor: segredos (o valor nunca aparece)', () => {
  it('exemplo: segredos do user_data sinalizados por nome e linha', () => {
    assert.deepEqual(
      segredos(exemplo()).map((s) => [s.onde, s.nome, s.linha]),
      [
        ['user_data', 'AWS_ACCESS_KEY_ID', 4],
        ['user_data', 'AWS_SECRET_ACCESS_KEY', 5],
      ],
    );
  });

  it('exemplo: nenhum valor secreto no plano serializado nem no resumo', () => {
    // Os valores tiram-se do ficheiro por uma regex própria do teste, independente do tradutor.
    const userData = (JSON.parse(EXEMPLO) as { resource: { aws_instance: { web: { user_data: string } } } }).resource.aws_instance.web.user_data;
    const valores = [...userData.matchAll(/^export [A-Z_]+=(\S+)$/gm)].map((m) => m[1]!);
    assert.equal(valores.length, 2);
    for (const adminIp of [ADMIN, '']) {
      const p = traduzir(EXEMPLO, { adminIp });
      for (const v of valores) {
        semValor(JSON.stringify(p), v, 'plano');
        semValor(resumoPlano(p), v, 'resumo');
      }
    }
  });

  it('o cloud-init copiado fica sem as linhas dos segredos e mantém o resto', () => {
    const cloudInit = exemplo().criar.find((c) => c.acao === 'criar-instancia')!.cloudInit!;
    assert.match(cloudInit, /git clone/);
    assert.match(cloudInit, /linha 5 removida: tinha AWS_SECRET_ACCESS_KEY/);
    assert.doesNotMatch(cloudInit, /^export AWS_/m);
  });

  it('segredos gerados ao acaso em todos os sítios: detetados, e nenhum valor no plano nem no resumo', () => {
    const v = () => `Fict${randomUUID().replaceAll('-', '')}`;
    const s = { a: v(), b: v(), c: v(), d: v(), e: v(), f: v(), g: v(), h: v(), i: v() };
    const chaveAws = `AKIA${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
    const corpoChave = randomUUID();
    const userData = [
      '#!/bin/bash',
      `DB_PASSWORD="${s.a}"`,
      `curl -H "x" --token ${s.b} https://example.com`,
      `psql postgres://app:${s.c}@db:5432/x -c "select 1"`,
      `echo ${chaveAws} > /tmp/k`,
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      corpoChave,
      '-----END OPENSSH PRIVATE KEY-----',
      'API_KEY=$API_KEY_FROM_VAULT',
      'echo pronto',
    ].join('\n');
    const tf = tfCom({
      instancia: { user_data: userData, tags: { Name: 'vm', ApiToken: s.d, Nota: `postgres://u:${s.e}@h/x` } },
      recursos: { aws_db_instance: { db: { engine: 'postgres', password: s.f, username: 'app' } } },
    });
    // Uma segunda instância só com user_data em base64.
    (tf.resource!.aws_instance as Record<string, unknown>).b64 = {
      instance_type: 'm5.large',
      ami: '${data.aws_ami.u.id}',
      user_data_base64: Buffer.from(`SECRET_KEY=${s.g}\n`).toString('base64'),
    };
    const p = traduzir(tf, { adminIp: ADMIN });

    assert.deepEqual(
      segredos(p).map((x) => [x.origem, x.onde, x.nome, x.linha ?? null]),
      [
        ['aws_instance.vm', 'user_data', 'DB_PASSWORD', 2],
        ['aws_instance.vm', 'user_data', '--token', 3],
        ['aws_instance.vm', 'user_data', 'senha num URL', 4],
        ['aws_instance.vm', 'user_data', 'chave de acesso AWS', 5],
        ['aws_instance.vm', 'user_data', 'chave privada', 6],
        ['aws_instance.vm', 'tags', 'ApiToken', null],
        ['aws_instance.vm', 'tags', 'Nota', null],
        ['aws_instance.b64', 'user_data', 'SECRET_KEY', 1],
        ['aws_db_instance.db', 'atributo', 'password', null],
      ],
    );
    const serializado = JSON.stringify(p);
    const resumo = resumoPlano(p);
    for (const valor of [...Object.values(s), chaveAws, corpoChave]) {
      semValor(serializado, valor, 'plano');
      semValor(resumo, valor, 'resumo');
    }
    // A referência a uma variável não é um segredo escrito à mão e a linha fica no cloud-init.
    assert.match(p.criar.find((c) => c.origem === 'aws_instance.vm' && c.acao === 'criar-instancia')!.cloudInit!, /API_KEY=\$API_KEY_FROM_VAULT/);
  });

  it('com o ficheiro em texto, os segredos nas tags e atributos levam a linha do ficheiro', () => {
    const segredo = `Fict${randomUUID()}`;
    const texto = JSON.stringify(
      { resource: { aws_db_instance: { db: { engine: 'postgres', tags: { DB_PASSWORD: segredo }, password: segredo } } } },
      null,
      2,
    );
    const p = traduzir(texto, { adminIp: ADMIN });
    const linhaDe = (chave: string) => texto.split('\n').findIndex((l) => l.includes(`"${chave}"`)) + 1;
    assert.deepEqual(
      segredos(p).map((s) => [s.onde, s.nome, s.linha]),
      [
        ['atributo', 'password', linhaDe('password')],
        ['tags', 'DB_PASSWORD', linhaDe('DB_PASSWORD')],
      ],
    );
    semValor(JSON.stringify(p), segredo, 'plano');
  });

  it('referências (${var.x}) não são segredos', () => {
    assert.ok(!exemplo().recusar.some((r) => r.tipo === 'segredo' && r.onde === 'atributo'));
  });

  it('última barreira: se um valor secreto fosse parar ao plano, não há plano e o erro não leva o valor', () => {
    const segredo = `nome-${randomUUID()}`;
    const tf = tfCom({ instancia: { user_data: `PASSWORD=${segredo}\n` } });
    (tf.resource!.aws_security_group as Record<string, Record<string, unknown>>).sg!.name = segredo;
    assert.throws(
      () => traduzir(tf, { adminIp: ADMIN }),
      (e: unknown) => e instanceof Error && /valor secreto/.test(e.message) && !e.message.includes(segredo),
    );
  });

  it('o tradutor não escreve nada na consola', () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => mock.method(console, m, () => {}));
    try {
      resumoPlano(exemplo());
      assert.deepEqual(espioes.map((e) => e.mock.callCount()), [0, 0, 0, 0, 0]);
    } finally {
      for (const e of espioes) e.mock.restore();
    }
  });
});

describe('tradutor: determinismo e resumo', () => {
  it('a mesma entrada dá sempre o mesmo plano e o mesmo resumo', () => {
    assert.deepEqual(exemplo(), exemplo());
    assert.equal(resumoPlano(exemplo()), resumoPlano(exemplo()));
    assert.deepEqual(traduzir(EXEMPLO, { adminIp: ADMIN }), traduzir(JSON.parse(EXEMPLO) as TerraformJson, { adminIp: ADMIN }));
  });

  it('resumo: curto (<= 600), com "move-se hoje", "recusei copiar" e "precisa de redesenho"', () => {
    for (const adminIp of [ADMIN, '']) {
      const r = resumoPlano(exemplo(adminIp));
      assert.ok(r.length <= 600, `resumo com ${r.length} caracteres`);
      assert.match(r, /Move-se hoje: servidor m5\.large \(Irlanda\) → lsw\.m5\.large em Amesterdão, Ubuntu 22\.04/);
      assert.match(r, /portas abertas a todos: 80, 443/);
      assert.match(r, /S3 → MinIO, SQS → RabbitMQ, RDS PostgreSQL → PostgreSQL/);
      assert.match(r, /Recusei copiar: PostgreSQL \(5432\) aberto a toda a Internet/);
      assert.match(r, /2 segredos no script de arranque \(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY\)/);
      assert.match(r, /Precisa de redesenho: IAM deploy, Lambda miniaturas/);
      assert.doesNotMatch(r, new RegExp(ADMIN.replaceAll('.', '\\.')));
    }
    assert.match(resumoPlano(exemplo()), /SSH \(22\) só para o teu IP/);
    assert.match(resumoPlano(exemplo('')), /SSH \(22\) fica fechado até pores o ADMIN_IP/);
  });
});
