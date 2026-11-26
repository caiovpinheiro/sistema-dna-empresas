import type { PoolClient } from "pg";

/** "YYYY-MM-DD" de um dia que existe no calendário (sem 30/02 ou mês 13), entre 1900 e 2100. */
export function dataIsoValida(valor: string | null | undefined): string | undefined {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const [ano, mes, dia] = valor.split("-").map(Number);
  if (ano < 1900 || ano > 2100) return undefined;
  const real = new Date(Date.UTC(ano, mes - 1, dia));
  return real.getUTCFullYear() === ano && real.getUTCMonth() === mes - 1 && real.getUTCDate() === dia ? valor : undefined;
}

/** CPF com os dois dígitos verificadores certos (só números; recusa 111.111.111-11 e parecidos). */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string) => {
    const soma = base.split("").reduce((total, numero, indice) => total + Number(numero) * (base.length + 1 - indice), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9)) === Number(cpf[9]) && digito(cpf.slice(0, 10)) === Number(cpf[10]);
}

type TabelaComId = "tabela_ponto" | "ferias" | "justificativa" | "ponto_turno_base" | "ponto_carga_base" | "feriados";

/**
 * Próximo id das tabelas antigas (sem sequência no banco). A trava vale até o fim da transação, então dois pedidos
 * ao mesmo tempo, de qualquer empresa, nunca recebem o mesmo número. Precisa rodar dentro de begin/commit.
 */
export async function proximoId(client: PoolClient, tabela: TabelaComId): Promise<number> {
  const coluna = tabela === "feriados" ? "id_feriado" : "id";
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`proximo-id-dna_work.${tabela}`]);
  const linha = await client.query<{ id: string }>(`select coalesce(max(${coluna}), 0) + 1 as id from dna_work.${tabela}`);
  return Number(linha.rows[0].id);
}
