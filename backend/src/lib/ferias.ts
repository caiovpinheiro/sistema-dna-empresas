/**
 * Regras da lei para lançar férias (CLT) e recesso (estágio). Datas em "YYYY-MM-DD".
 *
 * CLT:
 * - art. 130: até 30 dias por período aquisitivo (12 meses de contrato), só depois de completar esses 12 meses;
 * - art. 134 §1º: em até 3 períodos, um deles com pelo menos 14 dias e os outros com pelo menos 5;
 * - art. 134 §3º: não pode começar nos 2 dias antes de feriado ou do descanso semanal remunerado.
 * Estágio (Lei 11.788/2008, art. 13): recesso de até 30 dias a cada ano de estágio.
 */
export type Periodo = { inicio: string; fim: string };

export type ContextoFerias = {
  estagio: boolean;
  /** Início do contrato atual ("" se não souber). */
  inicioContrato: string;
  /** Férias e recessos já lançados neste contrato. */
  existentes: Periodo[];
  /** Feriado ou descanso semanal da pessoa nesse dia. */
  descansoOuFeriado: (iso: string) => boolean;
};

const DIA_MS = 86_400_000;

function utc(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

export function somarDias(iso: string, dias: number) {
  return new Date(utc(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function diasDoPeriodo(periodo: Periodo) {
  return Math.round((utc(periodo.fim) - utc(periodo.inicio)) / DIA_MS) + 1;
}

/** Meses completos de `de` até `ate` (o dia do mês conta: de 10/01 a 09/02 ainda é 0). */
function mesesCompletos(de: string, ate: string) {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** Ano do contrato em que a data cai (0 = primeiros 12 meses). */
function anoDoContrato(inicioContrato: string, iso: string) {
  return Math.floor(mesesCompletos(inicioContrato, iso) / 12);
}

/** Mensagem do problema, ou null quando o período pode ser lançado. */
export function problemaNasFerias(novo: Periodo, contexto: ContextoFerias): string | null {
  const dias = diasDoPeriodo(novo);
  const nome = contexto.estagio ? "recesso" : "férias";
  if (contexto.inicioContrato && novo.inicio < contexto.inicioContrato) {
    return `O ${nome === "recesso" ? "recesso" : "período de férias"} não pode começar antes do início do contrato.`;
  }
  if (contexto.estagio) {
    if (dias > 30) return "O recesso tem no máximo 30 dias por ano de estágio (Lei 11.788, art. 13).";
    if (contexto.inicioContrato) {
      const ano = anoDoContrato(contexto.inicioContrato, novo.inicio);
      const usados = contexto.existentes
        .filter((periodo) => anoDoContrato(contexto.inicioContrato, periodo.inicio) === ano)
        .reduce((total, periodo) => total + diasDoPeriodo(periodo), 0);
      if (usados + dias > 30) {
        return `Neste ano de estágio já há ${usados} dia(s) de recesso. O máximo é 30 dias por ano (Lei 11.788, art. 13).`;
      }
    }
    return null;
  }
  if (dias > 30) return "Cada período de férias tem no máximo 30 dias (CLT, art. 130).";
  if (dias < 5) return "Cada período de férias precisa ter pelo menos 5 dias (CLT, art. 134 §1º).";
  if (contexto.descansoOuFeriado(somarDias(novo.inicio, 1)) || contexto.descansoOuFeriado(somarDias(novo.inicio, 2))) {
    return "As férias não podem começar nos 2 dias antes de um feriado ou do descanso semanal (CLT, art. 134 §3º). Escolha outro dia para começar.";
  }
  if (!contexto.inicioContrato) return null;
  // Férias tiradas no ano N do contrato são do período aquisitivo anterior (o ano N - 1).
  const ano = anoDoContrato(contexto.inicioContrato, novo.inicio);
  if (ano < 1) {
    return "As férias só podem ser dadas depois de 12 meses de contrato, que é o período aquisitivo (CLT, art. 130).";
  }
  const mesmos = contexto.existentes.filter((periodo) => anoDoContrato(contexto.inicioContrato, periodo.inicio) === ano);
  const todos = [...mesmos, novo];
  const total = todos.reduce((soma, periodo) => soma + diasDoPeriodo(periodo), 0);
  if (todos.length > 3) return "As férias de um mesmo período aquisitivo podem ser divididas em no máximo 3 partes (CLT, art. 134 §1º).";
  if (total > 30) {
    return `Já há ${total - dias} dia(s) de férias lançados para este período aquisitivo. O máximo é 30 dias (CLT, art. 130).`;
  }
  const temQuatorze = todos.some((periodo) => diasDoPeriodo(periodo) >= 14);
  const sobraParte = todos.length < 3 && 30 - total >= 14;
  if (!temQuatorze && !sobraParte) {
    return "Um dos períodos de férias precisa ter pelo menos 14 dias (CLT, art. 134 §1º).";
  }
  return null;
}
