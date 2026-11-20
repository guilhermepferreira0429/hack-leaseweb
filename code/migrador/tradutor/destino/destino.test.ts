import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traduzir } from '../traduzir';
import { decidirDestino, mensagemDestino, ordenarGeridos, REGRAS, servicosDoPlano, type CapacidadeVm, type EntradaDecisor } from './index';
import { GERIDO_EUROPEU, type OpcaoGerida } from './tabelas';

const HOJE = new Date('2026-11-20T12:00:00Z');
const GRANDE: CapacidadeVm = { ramLivreGb: 125, vcpuLivres: 32, discoLivreGb: 500 };

const decidir = (e: Partial<EntradaDecisor> & Pick<EntradaDecisor, 'servicos'>) =>
  decidirDestino({ vm: GRANDE, temBackups: true, hoje: HOJE, ...e });

describe('decisor de destino: as 4 regras, pela ordem', () => {
  it('regra 1: base de dados (por omissão alta e com dados pessoais) -> gerido', () => {
    const [d] = decidir({ servicos: [{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }] });
    assert.equal(d!.destino, 'gerido');
    assert.equal(d!.numeroRegra, 1);
    assert.equal(d!.regra, REGRAS[1]);
    assert.equal(d!.criticidade, 'alta');
    assert.equal(d!.dadosPessoais, true);
  });

  it('regra 2: não cabe na VM -> gerido, com as contas no aviso', () => {
    const [d] = decidir({ servicos: [{ servico: 's3', dadosGb: 100 }], vm: { ramLivreGb: 8, vcpuLivres: 2, discoLivreGb: 50 } });
    assert.equal(d!.numeroRegra, 2);
    assert.equal(d!.destino, 'gerido');
    assert.ok(d!.avisos.some((a) => a.includes('Precisa de 1 GB de RAM e 120 GB de disco') && a.includes('50 GB de disco')));
  });

  it('regra 3: dados pessoais sem backups -> gerido; com backups -> self-hosted (regra 4)', () => {
    const servicos = [{ servico: 'cache' as const, dadosGb: 1, dadosPessoais: true }];
    const [sem] = decidir({ servicos, temBackups: false });
    assert.deepEqual([sem!.numeroRegra, sem!.destino, sem!.fornecedor], [3, 'gerido', 'Scaleway']);
    assert.equal(sem!.precoMes, 35.04); // RED1-MICRO € 0,048/h × 730 h
    const [com] = decidir({ servicos, temBackups: true });
    assert.deepEqual([com!.numeroRegra, com!.destino, com!.fornecedor], [4, 'self-hosted', 'Leaseweb']);
  });

  it('regra 4: cabe e não é crítico -> self-hosted na VM da Leaseweb, sem preço extra', () => {
    const [d] = decidir({ servicos: [{ servico: 'fila', nome: 'encomendas' }] });
    assert.deepEqual([d!.numeroRegra, d!.destino, d!.fornecedor, d!.plano], [4, 'self-hosted', 'Leaseweb', 'RabbitMQ na VM']);
    assert.equal(d!.precoMes, undefined);
  });

  it('ganha a primeira: crítico que também não cabe -> regra 1, não 2', () => {
    const [d] = decidir({ servicos: [{ servico: 'postgres', dadosGb: 1000 }], vm: { ramLivreGb: 1, vcpuLivres: 1, discoLivreGb: 10 } });
    assert.equal(d!.numeroRegra, 1);
  });

  it('criticidade alta sem alta disponibilidade não ativa a regra 1', () => {
    const [d] = decidir({ servicos: [{ servico: 'postgres', dadosGb: 1, altaDisponibilidade: false }] });
    assert.equal(d!.numeroRegra, 4);
  });
});

describe('decisor de destino: margem de 25% de RAM', () => {
  it('MinIO (1 GB) cabe numa VM com 1,34 GB livres e não cabe com 1,32 GB', () => {
    const minio = [{ servico: 's3' as const, dadosGb: 0 }];
    assert.equal(decidir({ servicos: minio, vm: { ramLivreGb: 1.34, vcpuLivres: 1, discoLivreGb: 10 } })[0]!.destino, 'self-hosted');
    assert.equal(decidir({ servicos: minio, vm: { ramLivreGb: 1.32, vcpuLivres: 1, discoLivreGb: 10 } })[0]!.numeroRegra, 2);
  });

  it('a RAM gasta pelos serviços self-hosted conta para os seguintes', () => {
    // 2 GB livres -> 1,5 GB utilizáveis: o MinIO (1 GB) entra, o RabbitMQ (0,5 GB) ainda entra, o NATS (0,25 GB) já não.
    const d = decidir({
      servicos: [{ servico: 's3', dadosGb: 1 }, { servico: 'fila' }, { servico: 'nats' }],
      vm: { ramLivreGb: 2, vcpuLivres: 2, discoLivreGb: 10 },
    });
    assert.deepEqual(d.map((x) => x.numeroRegra), [4, 4, 2]);
  });
});

describe('decisor de destino: escolher o gerido', () => {
  it('Leaseweb primeiro: S3 gerido vai para a Leaseweb mesmo havendo mais barato na tabela', () => {
    const ovh = GERIDO_EUROPEU.s3!.find((o) => o.fornecedor === 'OVHcloud')!;
    assert.ok(ovh.preco.tipo === 'gb-mes' && ovh.preco.valor < 0.01733);
    const [d] = decidir({ servicos: [{ servico: 's3', dadosGb: 100 }], vm: { ramLivreGb: 8, vcpuLivres: 2, discoLivreGb: 10 } });
    assert.deepEqual([d!.fornecedor, d!.plano, d!.precoMes, d!.moeda], ['Leaseweb', 'Object Storage on demand', 1.73, 'EUR']);
  });

  it('Leaseweb primeiro também com preço a confirmar (balanceador)', () => {
    const [d] = decidir({ servicos: [{ servico: 'balanceador', criticidade: 'alta' }] });
    assert.deepEqual([d!.fornecedor, d!.precoAConfirmar, d!.precoMes], ['Leaseweb', true, undefined]);
  });

  it('PostgreSQL: gerido da Leaseweb "por confirmar"; escolhe o europeu mais barato em euros (Scaleway DB-DEV-S)', () => {
    const [d] = decidir({ servicos: [{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }] });
    assert.deepEqual([d!.fornecedor, d!.plano, d!.precoMes, d!.precoVistoEm], ['Scaleway', 'DB-DEV-S (2 vCPU, 2 GB)', 11.39, '2026-11-20']);
    assert.ok(d!.avisos.some((a) => a.startsWith('Gerido da Leaseweb por confirmar')));
    assert.ok(d!.avisos.some((a) => a.includes('Alta disponibilidade a confirmar')));
  });

  it('precisa de alta disponibilidade: exclui opções que a tabela diz não terem (UpCloud 1 nó)', () => {
    const semUpCloud = ordenarGeridos(GERIDO_EUROPEU.postgres!.filter((o) => o.fornecedor !== 'Scaleway'), 5, undefined);
    assert.equal(semUpCloud[0]!.fornecedor, 'UpCloud'); // sem requisito de HA, o UpCloud (€) vem antes da OVH ($)
    const d = decidirDestino({ servicos: [{ servico: 'postgres', dadosGb: 5 }], vm: GRANDE, temBackups: true, hoje: HOJE });
    assert.notEqual(d[0]!.fornecedor, 'UpCloud');
  });

  it('não mistura moedas: preço em dólares só depois de todos os em euros', () => {
    const ordem = ordenarGeridos(GERIDO_EUROPEU.postgres!, 5, undefined).map((o) => o.fornecedor);
    assert.deepEqual(ordem, ['Scaleway', 'UpCloud', 'OVHcloud']);
  });

  it('empate no preço -> o do país do cliente; depois a ordem da tabela', () => {
    const base: Omit<OpcaoGerida, 'fornecedor' | 'pais'> = {
      plano: 'x',
      ue: true,
      preco: { tipo: 'mes', valor: 10, moeda: 'EUR' },
      altaDisponibilidade: 'desconhecido',
      vistoEm: '2026-11-20',
      fonte: 'teste',
    };
    const opcoes = [{ ...base, fornecedor: 'A', pais: 'FR' }, { ...base, fornecedor: 'B', pais: 'PT' }];
    assert.equal(ordenarGeridos(opcoes, 0, 'PT')[0]!.fornecedor, 'B');
    assert.equal(ordenarGeridos(opcoes, 0, 'DE')[0]!.fornecedor, 'A');
  });

  it('fora da UE nunca é escolhido (Exoscale, Suíça)', () => {
    assert.ok(GERIDO_EUROPEU.s3!.some((o) => o.fornecedor === 'Exoscale' && !o.ue));
  });

  it('sem gerido na tabela (DynamoDB) -> "por escolher", sem inventar fornecedor nem preço', () => {
    const [d] = decidir({ servicos: [{ servico: 'dynamodb', dadosGb: 1 }] });
    assert.deepEqual([d!.destino, d!.fornecedor, d!.plano, d!.precoMes], ['gerido', 'por escolher', undefined, undefined]);
    assert.match(mensagemDestino([d!], GRANDE), /decide à mão/);
  });
});

describe('decisor de destino: preços', () => {
  it('preço com mais de 30 dias -> "preço a confirmar", sem contas', () => {
    const servicos = [{ servico: 'postgres' as const, nome: 'encomendas', dadosGb: 5 }];
    const aos30 = decidir({ servicos, hoje: new Date('2026-12-20T00:00:00Z') })[0]!;
    assert.equal(aos30.precoAConfirmar, false);
    const aos31 = decidir({ servicos, hoje: new Date('2026-12-21T12:00:00Z') })[0]!;
    assert.deepEqual([aos31.precoAConfirmar, aos31.precoMes, aos31.fornecedor], [true, undefined, 'Scaleway']);
    assert.match(mensagemDestino([aos31], GRANDE), /proponho Scaleway DB-DEV-S \(2 vCPU, 2 GB\), preço a confirmar\./);
  });

  it('serviço que existe mas sem preço publicado (Secret Manager) -> preço a confirmar', () => {
    const [d] = decidir({ servicos: [{ servico: 'segredos', criticidade: 'alta' }] });
    assert.deepEqual([d!.fornecedor, d!.precoAConfirmar], ['Scaleway', true]);
  });

  it('preço por uso não vira mensal: mostra o preço por GB com a data', () => {
    const [d] = decidir({ servicos: [{ servico: 'fila', criticidade: 'alta' }] });
    assert.deepEqual([d!.precoMes, d!.precoUnidade], [undefined, '€ 0,01/GB']);
    assert.match(mensagemDestino([d!], GRANDE), /€ 0,01\/GB \(preço visto a 20\/11\/2026\)/);
  });
});

describe('decisor de destino: tudo self-hosted', () => {
  it('modo "tudo self-hosted": tudo na VM, com avisos honestos', () => {
    const d = decidir({
      servicos: [{ servico: 's3', dadosGb: 1 }, { servico: 'postgres', dadosGb: 1 }],
      temBackups: false,
      vm: { ramLivreGb: 2, vcpuLivres: 2, discoLivreGb: 100 },
      modo: 'tudo-self-hosted',
    });
    assert.deepEqual(d.map((x) => [x.destino, x.numeroRegra]), [
      ['self-hosted', 0],
      ['self-hosted', 0],
    ]);
    const pg = d[1]!;
    assert.ok(pg.avisos.some((a) => a.startsWith('Não cabe')));
    assert.ok(pg.avisos.some((a) => a.includes('não há backups')));
    assert.ok(pg.avisos.some((a) => a.includes('sem alta disponibilidade')));
    const m = mensagemDestino(d, { ramLivreGb: 2, vcpuLivres: 2, discoLivreGb: 100 });
    assert.match(m, /O MinIO e o PostgreSQL ficam nela\. Escolheste tudo self-hosted\./);
    assert.match(m, /Atenção: o PostgreSQL não cabe/);
  });

  it('recomendado com VM grande, backups e nada crítico -> tudo self-hosted pelas regras', () => {
    const d = decidir({
      servicos: [{ servico: 's3', dadosGb: 20 }, { servico: 'fila' }, { servico: 'postgres', dadosGb: 5, criticidade: 'media' }],
    });
    assert.ok(d.every((x) => x.destino === 'self-hosted' && x.numeroRegra === 4));
  });
});

describe('decisor de destino: serviços novos (OpenBao, Valkey, ScyllaDB)', () => {
  it('OpenBao: crítico por omissão -> gerido (Scaleway Secret Manager, preço a confirmar); 256 MB se o dono baixar a criticidade', () => {
    const [d] = decidir({ servicos: [{ servico: 'segredos', nome: 'db, api_token' }] });
    assert.deepEqual([d!.criticidade, d!.numeroRegra, d!.fornecedor, d!.precoAConfirmar], ['alta', 1, 'Scaleway', true]);
    const [self] = decidir({ servicos: [{ servico: 'segredos', criticidade: 'media' }] });
    assert.deepEqual([self!.destino, self!.precisa.ramGb], ['self-hosted', 0.25]);
  });

  it('Valkey: RAM = dados em RAM × 1,5, com a margem de 25%', () => {
    const cache = [{ servico: 'cache' as const, dadosGb: 2 }]; // precisa de 3 GB
    assert.equal(decidir({ servicos: cache, vm: { ramLivreGb: 4, vcpuLivres: 2, discoLivreGb: 10 } })[0]!.destino, 'self-hosted');
    const naoCabe = decidir({ servicos: cache, vm: { ramLivreGb: 3.9, vcpuLivres: 2, discoLivreGb: 10 } })[0]!;
    assert.deepEqual([naoCabe.numeroRegra, naoCabe.fornecedor, naoCabe.plano, naoCabe.precoMes], [2, 'Scaleway', 'RED1-MICRO (2 vCPU, 2 GB)', 35.04]);
  });

  it('ScyllaDB: 2 GB de RAM e disco = dados × 2', () => {
    const [d] = decidir({ servicos: [{ servico: 'dynamodb', dadosGb: 3, criticidade: 'media', dadosPessoais: false }] });
    assert.deepEqual([d!.destino, d!.precisa], ['self-hosted', { ramGb: 2, discoGb: 6 }]);
  });

  it('mensagem: um porquê por regra diferente, no fim', () => {
    const vm: CapacidadeVm = { ramLivreGb: 8, vcpuLivres: 2, discoLivreGb: 100 };
    const m = mensagemDestino(decidir({ servicos: [{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }, { servico: 'segredos', nome: 'db' }], vm }), vm);
    assert.equal(m.match(/Porquê:/g)!.length, 1);
    assert.match(m, /O Secrets Manager \(db\): proponho Scaleway Secret Manager, preço a confirmar\. Porquê: /);
  });
});

describe('decisor de destino: ligação ao tradutor e mensagem', () => {
  it('servicosDoPlano lê o substituir do tradutor', () => {
    const plano = traduzir(readFileSync(new URL('../exemplo/main.tf.json', import.meta.url), 'utf8'), { adminIp: '' });
    assert.deepEqual(servicosDoPlano(plano), [
      { servico: 's3', nome: 'ficheiros' },
      { servico: 'fila', nome: 'encomendas' },
      { servico: 'postgres', nome: 'encomendas' },
      { servico: 'segredos', nome: 'db, api_token' }, // Secrets Manager e SSM: um só OpenBao
      { servico: 'cache', nome: 'sessoes' },
      { servico: 'dynamodb', nome: 'carrinhos' },
    ]);
  });

  it('mensagem segue o modelo do doc e é determinística', () => {
    const servicos = [{ servico: 's3' as const, dadosGb: 20 }, { servico: 'fila' as const }, { servico: 'postgres' as const, nome: 'encomendas', dadosGb: 5 }];
    const vm: CapacidadeVm = { ramLivreGb: 8, vcpuLivres: 2, discoLivreGb: 100 };
    const m = mensagemDestino(decidir({ servicos, vm }), vm);
    assert.equal(
      m,
      'A tua VM tem 8 GB de RAM livres. O MinIO e o RabbitMQ ficam nela. ' +
        'A base de dados encomendas é crítica e tem dados pessoais: proponho Scaleway DB-DEV-S (2 vCPU, 2 GB), ' +
        'cerca de € 11,39/mês (preço visto a 20/11/2026). Porquê: ' +
        REGRAS[1],
    );
    assert.equal(mensagemDestino(decidir({ servicos, vm }), vm), m);
  });
});
