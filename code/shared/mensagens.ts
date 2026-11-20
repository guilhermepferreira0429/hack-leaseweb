// Mensagens fixas da demo, passo a passo. Fonte: docs/agentes/mensagens-demo.md (quem muda o texto, muda lá primeiro).
// O texto fixo é a base e o recurso quando o LLM falha; a IA só pode melhorar a explicação.
// Só factos medidos: cada função recebe valores do estado e da auditoria; o que faltar sai como "not measured".
// Textos em inglês: a demo e o pitch são em inglês (decisão do Guilherme às 13:05).
// Nenhuma mensagem promete uma ação: as ações só acontecem pelos botões.
import type { Agente } from './bus';
import type { Acao } from './tipos';

export type PassoDemo = 'abertura' | 'plano' | 'confirmacao' | 'migrar' | 'atacar' | 'defender' | 'codigo' | 'validar' | 'relatorio';

/** Linha "a pensar" do painel: texto fixo por passo, não o raciocínio do modelo. Em inglês (decisão das 13:05). */
export const PENSAR: Record<PassoDemo, { agente: Agente; texto: string }> = {
  abertura: { agente: 'chefe', texto: 'Getting the team ready.' },
  plano: { agente: 'migrador', texto: 'Reading the app and deciding where each service goes.' },
  confirmacao: { agente: 'chefe', texto: 'Waiting for approval.' },
  migrar: { agente: 'migrador', texto: 'Copying the data and comparing checksums.' },
  atacar: { agente: 'atacante', texto: 'Checking what our machines show to the outside.' },
  defender: { agente: 'defesa', texto: 'Explaining the risk and preparing a reversible fix.' },
  codigo: { agente: 'migrador', texto: 'Fixing the code to point at Leaseweb and close the cause.' },
  validar: { agente: 'chefe', texto: 'Checking that everything is up.' },
  relatorio: { agente: 'chefe', texto: 'Writing the certificate from the audit log.' },
};

export const NAO_MEDIDO = 'not measured';

export type Valor = string | number | boolean | undefined;

function formatar(v: Valor): string {
  if (v === undefined || v === '') return NAO_MEDIDO;
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : NAO_MEDIDO;
  return v;
}

/** Troca cada {chave} pelo valor. Sem valor -> "not measured"; boolean -> ✓ / ✗. */
export function preencher(modelo: string, vars: Record<string, Valor>): string {
  return modelo.replace(/\{([a-z0-9_]+)\}/gi, (_, chave: string) => formatar(Object.hasOwn(vars, chave) ? vars[chave] : undefined));
}

/** Os modelos, em inglês (a demo e o pitch são em inglês). A estrutura segue o mensagens-demo.md. */
export const MODELOS = {
  abertura: 'Good morning. We are moving the {app} app from AWS to Leaseweb, safely. I will report at every step.',
  plano: 'I found {n_servicos} AWS services in the app: {lista_servicos}.\nProposal:\n{linhas_proposta}\nThe VM has {ram_livre} GB free. {motivo_regra}',
  linhaProposta: '· {servico} → {destino} ({self_ou_gerido})',
  planoAprovado: 'Plan approved by {quem} at {hora}. @migrador, go ahead.',
  migracao:
    'Migration complete.\n· Files: {n_objetos} copied · checksum {ok_s3}\n· Database: {n_linhas} rows · checksum {ok_bd}\n· App tests: before {ok_antes} · after {ok_depois}\nThe new infrastructure is live. @atacante, your turn.',
  ataque: 'I found the new database open to the whole Internet (port {porta}).\nSeverity: {gravidade}. Anyone can try to get in.\n@defesa',
  defesaExplicacao: 'The database with the company data is open to the whole Internet.\nSomeone outside could try to guess the password and get in.',
  defesaProposta: 'I propose closing outside access and allowing only your app. I keep a way to undo it.',
  fechado: 'Closed at {hora_fecho} and confirmed. Time exposed: {segundos} s.\nUndo saved: /desfazer {pedido_id}\n@atacante, please confirm.',
  atacanteConfirma: 'Confirmed. I can no longer reach it.',
  codigo:
    'I opened PR #{numero}: {n_ficheiros} files changed, tests passing.\n· The app now uses Leaseweb instead of AWS.\n· I fixed the configuration that left the database open, so it does not come back on the next deploy.',
  validacao: 'Final check: tests {testes}, nothing exposed {nada_exposto}, data identical {dados_iguais}.',
  fimRelatorio:
    'In {minutos} min we moved from AWS to Leaseweb, closed {n_falhas} issue(s) and fixed the cause in the code. Nothing left the EU.',
} as const;

// 0. Abertura (Chefe)
export function msgAbertura(v: { app?: string } = {}): string {
  return preencher(MODELOS.abertura, { app: v.app });
}

// 1. Decidir para onde migrar (Migrador). Uma linha por serviço; o modelo do doc mostra 3 como exemplo.
export function msgPlano(v: {
  servicos?: { servico: string; destino: string; selfOuGerido?: 'self-hosted' | 'gerido' }[];
  ramLivreGb?: number;
  motivoRegra?: string;
}): string {
  const servicos = v.servicos ?? [];
  const linhas = servicos.map((s) =>
    preencher(MODELOS.linhaProposta, {
      servico: s.servico,
      destino: s.destino,
      self_ou_gerido: s.selfOuGerido === 'gerido' ? 'managed' : s.selfOuGerido,
    }),
  );
  return preencher(MODELOS.plano, {
    n_servicos: v.servicos ? servicos.length : undefined,
    lista_servicos: servicos.length > 0 ? servicos.map((s) => s.servico).join(', ') : undefined,
    linhas_proposta: linhas.length > 0 ? linhas.join('\n') : undefined,
    ram_livre: v.ramLivreGb,
    motivo_regra: v.motivoRegra,
  });
}

// 2. Confirmação (Chefe), depois do toque
export function msgPlanoAprovado(v: { quem?: string; hora?: string }): string {
  return preencher(MODELOS.planoAprovado, { quem: v.quem, hora: v.hora });
}

// 3. Migrar (Migrador)
export function msgMigracao(v: {
  nObjetos?: number;
  okS3?: boolean;
  nLinhas?: number;
  okBd?: boolean;
  okAntes?: boolean;
  okDepois?: boolean;
}): string {
  return preencher(MODELOS.migracao, {
    n_objetos: v.nObjetos,
    ok_s3: v.okS3,
    n_linhas: v.nLinhas,
    ok_bd: v.okBd,
    ok_antes: v.okAntes,
    ok_depois: v.okDepois,
  });
}

// 4. Atacar (Atacante)
export function msgAtaque(v: { porta?: number; gravidade?: string }): string {
  return preencher(MODELOS.ataque, { porta: v.porta, gravidade: v.gravidade });
}

/**
 * 5. Defender (Defesa), antes do toque. A IA pode reescrever as 2 primeiras frases (`explicacaoIA`);
 * sem ela, fica o texto fixo. A proposta final é sempre a fixa.
 */
export function msgDefesa(v: { explicacaoIA?: string } = {}): string {
  const explicacao = v.explicacaoIA?.trim() || MODELOS.defesaExplicacao;
  return `${explicacao}\n${MODELOS.defesaProposta}`;
}

// 5. Defender (Defesa), depois de fechar e verificar
export function msgFechado(v: { horaFecho?: string; segundos?: number; pedidoId?: string }): string {
  return preencher(MODELOS.fechado, { hora_fecho: v.horaFecho, segundos: v.segundos, pedido_id: v.pedidoId });
}

// 5. Atacante confirma o fecho
export function msgAtacanteConfirma(): string {
  return MODELOS.atacanteConfirma;
}

// 6. Migrar o código (Migrador)
export function msgCodigo(v: { numero?: number; nFicheiros?: number; url?: string }): string {
  const texto = preencher(MODELOS.codigo, { numero: v.numero, n_ficheiros: v.nFicheiros });
  return v.url ? `${texto}\n${v.url}` : texto;
}

// 7. Validar tudo (Chefe)
export function msgValidacao(v: { testes?: boolean; nadaExposto?: boolean; dadosIguais?: boolean }): string {
  return preencher(MODELOS.validacao, { testes: v.testes, nada_exposto: v.nadaExposto, dados_iguais: v.dadosIguais });
}

// 8. Relatório (Chefe): o certificado, se houver, seguido da frase final.
export function msgFimRelatorio(v: { minutos?: number; nFalhas?: number; certificado?: string }): string {
  const fim = preencher(MODELOS.fimRelatorio, { minutos: v.minutos, n_falhas: v.nFalhas });
  return v.certificado?.trim() ? `${v.certificado.trim()}\n\n${fim}` : fim;
}

/** Respostas fixas úteis (fim do mensagens-demo.md). */
export const RESPOSTAS_FIXAS = {
  foraDoEstado: "I don't have that information. Type /estado to see the current status.",
  pedidoIgnorado: 'OK, leaving it as it is. Your decision not to close it is logged.',
  erroApi: 'Leaseweb did not answer in time. I changed nothing. I will try again.',
} as const;

/** Texto dos botões de um pedido. "Tudo self-hosted" e "Porquê?" ficam de fora (decisão da equipa). */
export function botoesPara(acao: Acao): { aprovar: string; ignorar: string } {
  switch (acao.tipo) {
    case 'migrar':
      return { aprovar: 'Approve plan', ignorar: 'Ignore' };
    case 'remover_regra':
      return { aprovar: 'Close', ignorar: 'Ignore' };
    case 'aprovar_pr':
      return { aprovar: 'Approve PR', ignorar: 'Ignore' };
  }
}
