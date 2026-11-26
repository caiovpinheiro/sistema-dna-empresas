/**
 * Feriados nacionais pela BrasilAPI (https://brasilapi.com.br/api/feriados/v1/{ano}), com cache por ano.
 * Estaduais e municipais não têm fonte confiável: a empresa cadastra os dela em dna_work.feriados.
 */
export type FeriadoNacional = { data: string; nome: string };

const DIA_MS = 24 * 60 * 60 * 1000;
const cache = new Map<number, { quando: number; lista: FeriadoNacional[] }>();
const NAO_SAO_NACIONAIS = /carnaval|corpus christi|quarta-feira de cinzas/i;
const semAcentos = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lista do ano (data YYYY-MM-DD). `ok` false quando a BrasilAPI não respondeu: a lista volta vazia e não fica no cache. */
export async function feriadosNacionais(ano: number): Promise<{ ok: boolean; lista: FeriadoNacional[] }> {
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2199) return { ok: false, lista: [] };
  const guardado = cache.get(ano);
  if (guardado && Date.now() - guardado.quando < DIA_MS) return { ok: true, lista: guardado.lista };
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 5000);
  try {
    const resposta = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, {
      signal: controle.signal,
      headers: { accept: "application/json", "user-agent": "DNAWorkPortal/1.0" },
    });
    if (!resposta.ok) return { ok: false, lista: guardado?.lista ?? [] };
    const corpo = await resposta.json() as Array<{ date?: string; name?: string }>;
    const lista = corpo
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? "") && item.name)
      // A BrasilAPI manda Carnaval e Corpus Christi como nacionais, mas pela lei federal são ponto facultativo
      // (Leis 662/49 e 10.607/02). Quem dá folga nesses dias cadastra como feriado da empresa.
      .filter((item) => !NAO_SAO_NACIONAIS.test(semAcentos(item.name!)))
      .map((item) => ({ data: item.date!, nome: item.name!.trim() }));
    cache.set(ano, { quando: Date.now(), lista });
    return { ok: true, lista };
  } catch {
    return { ok: false, lista: guardado?.lista ?? [] };
  } finally {
    clearTimeout(timer);
  }
}

export const ABRANGENCIAS = ["municipal", "estadual", "empresa"] as const;
export type Abrangencia = (typeof ABRANGENCIAS)[number];

/** Data do banco ("YYYY/MM/DD" ou "YYYY-MM-DD") para "YYYY-MM-DD"; null se não for data. */
export function isoDe(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim().replaceAll("/", "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

/** Data do feriado no ano pedido: o fixo repete o dia e o mês; o do ano só vale no próprio ano. 29/02 fixo não existe nos outros anos. */
export function dataNoAno(iso: string, fixo: boolean, ano: number): string | null {
  if (!fixo) return iso.startsWith(`${ano}-`) ? iso : null;
  const data = `${ano}${iso.slice(4)}`;
  const [a, m, d] = data.split("-").map(Number);
  const real = new Date(Date.UTC(a, m - 1, d));
  return real.getUTCMonth() === m - 1 && real.getUTCDate() === d ? data : null;
}
