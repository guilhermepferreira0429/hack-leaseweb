import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { decidirDestino, simularProvisionamento, VMS_LEASEWEB, type CapacidadeVm, type EntradaServico } from './index';

const HOJE = new Date('2026-11-20T12:00:00Z');
const VM: CapacidadeVm = { ramLivreGb: 122, vcpuLivres: 32, discoLivreGb: 100 };
const decidir = (servicos: EntradaServico[], vm: CapacidadeVm = VM) => decidirDestino({ servicos, vm, temBackups: false, hoje: HOJE });

describe('simularProvisionamento (dry-run na Leaseweb)', () => {
  it('"DRY-RUN: nothing was created" na primeira linha, e nunca chama a rede', () => {
    const fetch = mock.method(globalThis, 'fetch', () => {
      throw new Error('não pode chamar a rede');
    });
    try {
      const { texto } = simularProvisionamento(decidir([{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }]), { redeApp: '10.0.1.0/24' });
      assert.equal(texto.split('\n')[0], 'DRY-RUN: nothing was created.');
      assert.equal(fetch.mock.callCount(), 0);
    } finally {
      fetch.mock.restore();
    }
  });

  it('Postgres crítico (ia para a Scaleway): VM dedicada na Leaseweb com os 4 pedidos do tradutor, só a app entra', () => {
    const { chamadas, texto } = simularProvisionamento(decidir([{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }]), { redeApp: '10.0.1.0/24' });
    assert.deepEqual(
      chamadas.map((c) => `${c.metodo} ${c.caminho}`),
      [
        'POST /instances',
        'POST /securityGroups',
        'POST /securityGroups/{securityGroupId:postgres-encomendas}/authorizeFirewallRules',
        'POST /instances/{instanceId:postgres-encomendas}/attachSecurityGroups',
      ],
    );
    assert.deepEqual(chamadas[0]!.corpo, {
      region: 'eu-west-3',
      type: 'lsw.c3.large',
      imageId: 'UBUNTU_22_04_64BIT',
      contractType: 'HOURLY',
      rootDiskSize: 50,
      rootDiskStorageType: 'CENTRAL',
      reference: 'postgres-encomendas',
    });
    assert.deepEqual(chamadas[2]!.corpo, { rules: [{ protocol: 'TCP', startPort: 5432, endPort: 5432, source: '10.0.1.0/24' }] });
    // € 26,02 da VM + 50 GB × € 0,08 = € 30,02, com a data do preço.
    assert.match(texto, /PostgreSQL \(encomendas\) on a dedicated Leaseweb VM instead of Scaleway: lsw\.c3\.large \(2 vCPU, 3 GB\), about €30\.02\/month with 50 GB disk \(prices seen on 20\/11\/2026\)\./);
    assert.match(texto, /A dedicated VM is not high availability, and backups are on us\./);
  });

  it('nunca abre ao mundo: sem redeApp fica um marcador; 0.0.0.0/0 é recusado', () => {
    const decisoes = decidir([{ servico: 'postgres', dadosGb: 5 }]);
    const { chamadas } = simularProvisionamento(decisoes);
    assert.equal((chamadas[2]!.corpo as { rules: { source: string }[] }).rules[0]!.source, '{appNetwork}');
    for (const mau of ['0.0.0.0/0', '::/0']) assert.throws(() => simularProvisionamento(decisoes, { redeApp: mau }), /Internet/);
  });

  it('no máximo 2 serviços, primeiro os críticos', () => {
    const decisoes = decidir([
      { servico: 'cache', dadosGb: 1, criticidade: 'media', dadosPessoais: true }, // gerido pela regra 3 (sem backups)
      { servico: 'postgres', nome: 'encomendas', dadosGb: 5 },
      { servico: 'segredos', nome: 'db' },
    ]);
    const { chamadas } = simularProvisionamento(decisoes);
    const vms = chamadas.filter((c) => c.caminho === '/instances').map((c) => (c.corpo as { reference: string }).reference);
    assert.deepEqual(vms, ['postgres-encomendas', 'segredos-db']);
  });

  it('tamanho da VM pela RAM com a margem de 25%; disco maior soma ao preço; sem VM que chegue, mantém o gerido', () => {
    const pequena = simularProvisionamento(decidir([{ servico: 'cache', dadosGb: 4, criticidade: 'alta' }])); // 6 GB / 0,75 = 8 GB
    assert.equal((pequena.chamadas[0]!.corpo as { type: string }).type, 'lsw.r3.large');
    const disco = simularProvisionamento(decidir([{ servico: 'postgres', dadosGb: 100 }])); // 150 GB de disco
    assert.equal((disco.chamadas[0]!.corpo as { rootDiskSize: number }).rootDiskSize, 150);
    assert.match(disco.texto, /about €38\.02\/month with 150 GB disk/); // 26,02 + 150 × 0,08
    const grande = simularProvisionamento(decidir([{ servico: 'cache', dadosGb: 10, criticidade: 'alta' }])); // 15 GB / 0,75 = 20 GB
    assert.deepEqual(grande.chamadas, []);
    assert.match(grande.texto, /no Leaseweb VM in the price table is big enough; keep Scaleway/);
    assert.ok(VMS_LEASEWEB.every((v) => v.ramGb < 20));
  });

  it('S3 gerido já é da Leaseweb (Object Storage): passo no portal, sem inventar uma chamada à API', () => {
    const { chamadas, texto } = simularProvisionamento(decidir([{ servico: 's3', dadosGb: 10, criticidade: 'alta' }]));
    assert.deepEqual(chamadas.map((c) => c.metodo), ['PORTAL']);
    assert.match(chamadas[0]!.resumo, /no public API call documented; to confirm/);
    assert.match(texto, /S3 → Leaseweb Object Storage on demand \(managed by Leaseweb\)\./);
  });

  it('tudo self-hosted: nada a sugerir, nenhuma chamada', () => {
    const decisoes = decidirDestino({ servicos: [{ servico: 's3', dadosGb: 1 }, { servico: 'fila' }], vm: VM, temBackups: true, hoje: HOJE });
    const { chamadas, texto } = simularProvisionamento(decisoes);
    assert.deepEqual(chamadas, []);
    assert.match(texto, /^DRY-RUN: nothing was created\.\nNo Leaseweb option to suggest for these services\./);
  });

  it('determinístico', () => {
    const decisoes = decidir([{ servico: 'postgres', nome: 'encomendas', dadosGb: 5 }, { servico: 'segredos', nome: 'db' }]);
    assert.deepEqual(simularProvisionamento(decisoes, { redeApp: '10.0.1.0/24' }), simularProvisionamento(decisoes, { redeApp: '10.0.1.0/24' }));
  });
});
