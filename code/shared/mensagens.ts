// Mensagens fixas da demo, passo a passo. Fonte: docs/agentes/mensagens-demo.md (quem muda o texto, muda lá primeiro).
// O texto fixo é a base e o recurso quando o LLM falha; a IA só pode melhorar a explicação.
// Só factos medidos: cada função recebe valores do estado e da auditoria; o que faltar sai como "não medido".
// Nenhuma mensagem promete uma ação: as ações só acontecem pelos botões.
import type { Agente } from './bus';
import type { Acao } from './tipos';

export type PassoDemo = 'abertura' | 'plano' | 'confirmacao' | 'migrar' | 'atacar' | 'defender' | 'codigo' | 'validar' | 'relatorio';

/** Linha "a pensar" do painel: texto fixo por passo, não o raciocínio do modelo. */
export const PENSAR: Record<PassoDemo, { agente: Agente; texto: string }> = {
  abertura: { agente: 'chefe', texto: 'A preparar a equipa.' },
  plano: { agente: 'migrador', texto: 'A ler a app e a decidir onde fica cada serviço.' },
  confirmacao: { agente: 'chefe', texto: 'À espera da aprovação.' },
  migrar: { agente: 'migrador', texto: 'A copiar os dados e a comparar checksums.' },
  atacar: { agente: 'atacante', texto: 'A ver o que se vê de fora nas nossas máquinas.' },
  defender: { agente: 'defesa', texto: 'A explicar o risco e a preparar o fecho reversível.' },
  codigo: { agente: 'migrador', texto: 'A corrigir o código para apontar para a Leaseweb e fechar a causa.' },
  validar: { agente: 'chefe', texto: 'A confirmar que está tudo de pé.' },
  relatorio: { agente: 'chefe', texto: 'A escrever o certificado a partir da auditoria.' },
};

export const NAO_MEDIDO = 'não medido';

export type Valor = string | number | boolean | undefined;

function formatar(v: Valor): string {
  if (v === undefined || v === '') return NAO_MEDIDO;
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : NAO_MEDIDO;
  return v;
}

/** Troca cada {chave} pelo valor. Sem valor -> "não medido"; boolean -> ✓ / ✗; números com vírgula decimal. */
export function preencher(modelo: string, vars: Record<string, Valor>): string {
  return modelo.replace(/\{([a-z0-9_]+)\}/gi, (_, chave: string) => formatar(Object.hasOwn(vars, chave) ? vars[chave] : undefined));
}

/** Os modelos, tal como estão no mensagens-demo.md. */
export const MODELOS = {
  abertura: 'Bom dia. Vamos tirar a app {app} da AWS e trazê-la para a Leaseweb, com segurança. Eu aviso em cada passo.',
  plano: 'Encontrei {n_servicos} serviços da AWS na app: {lista_servicos}.\nProposta:\n{linhas_proposta}\nA VM tem {ram_livre} GB livres. {motivo_regra}',
  linhaProposta: '· {servico} → {destino} ({self_ou_gerido})',
  planoAprovado: 'Plano aprovado por {quem} às {hora}. @migrador, avança.',
  migracao:
    'Migração concluída.\n· Ficheiros: {n_objetos} copiados · checksum {ok_s3}\n· Base de dados: {n_linhas} linhas · checksum {ok_bd}\n· Testes da app: antes {ok_antes} · depois {ok_depois}\nA infraestrutura nova está no ar. @atacante, a tua vez.',
  ataque: 'Encontrei a base de dados nova aberta a toda a Internet (porta {porta}).\nGravidade: {gravidade}. Qualquer pessoa pode tentar entrar.\n@defesa',
  defesaExplicacao: 'A base de dados com os dados da empresa está aberta a toda a Internet.\nAlguém de fora pode tentar adivinhar a palavra-passe e entrar.',
  defesaProposta: 'Proponho fechar o acesso de fora e deixar só a vossa app. Guardo como voltar atrás.',
  fechado: 'Fechado às {hora_fecho} e confirmado. Tempo exposto: {segundos} s.\nGuardei como voltar atrás: /desfazer {pedido_id}\n@atacante, confirma.',
  atacanteConfirma: 'Confirmo. Já não chego lá.',
  codigo:
    'Abri o PR #{numero}: {n_ficheiros} ficheiros alterados, testes a passar.\n· A app passa a usar a Leaseweb em vez da AWS.\n· Corrigi a configuração que deixava a base de dados aberta, para não voltar no próximo deploy.',
  validacao: 'Validação final: testes {testes}, nada exposto {nada_exposto}, dados iguais {dados_iguais}.',
  fimRelatorio:
    'Em {minutos} min saímos da AWS para a Leaseweb, fechámos {n_falhas} falha(s) e corrigimos a causa no código. Nada saiu da UE.',
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
    preencher(MODELOS.linhaProposta, { servico: s.servico, destino: s.destino, self_ou_gerido: s.selfOuGerido }),
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
  foraDoEstado: 'Não tenho essa informação. Escreva /estado para ver o ponto da situação.',
  pedidoIgnorado: 'Ok, fica como está. Fica registado que decidiu não fechar.',
  erroApi: 'A Leaseweb não respondeu a tempo. Não mudei nada. Vou tentar outra vez.',
} as const;

/** Texto dos botões de um pedido. "Tudo self-hosted" e "Porquê?" ficam de fora (decisão da equipa). */
export function botoesPara(acao: Acao): { aprovar: string; ignorar: string } {
  switch (acao.tipo) {
    case 'migrar':
      return { aprovar: 'Aprovar plano', ignorar: 'Ignorar' };
    case 'remover_regra':
      return { aprovar: 'Fechar', ignorar: 'Ignorar' };
  }
}
