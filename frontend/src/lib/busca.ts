/**
 * Busca inteligente das listas: filtra enquanto a pessoa digita, sem diferença de maiúscula ou acento ("joao" acha "João"),
 * com várias palavras em qualquer ordem e em qualquer coluna ("vendedor bruno" acha Bruno, Vendedor), CPF e telefone com ou
 * sem pontuação, e datas no formato brasileiro (dd/mm/aaaa) ou do banco.
 */
export function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Texto onde a busca procura: os valores das colunas, os números sem pontuação e as datas nos dois formatos. */
function indice(valores: unknown[]) {
  const partes: string[] = [];
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue;
    const texto = String(valor);
    partes.push(normalizar(texto));
    const digitos = texto.replace(/\D/g, "");
    if (digitos.length >= 3) partes.push(digitos);
    const data = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(texto);
    if (data) partes.push(`${data[3]}/${data[2]}/${data[1]}`);
  }
  return partes.join(" ");
}

/** A linha combina quando todas as palavras digitadas aparecem em alguma coluna. */
export function combina(valores: unknown[], termo: string) {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  const alvo = indice(valores);
  return palavras.every((palavra) => alvo.includes(palavra) || (/\d/.test(palavra) && alvo.includes(palavra.replace(/\D/g, ""))));
}

/** Filtra uma lista de objetos pelas colunas informadas (ou por todos os campos). */
export function filtrar<T extends Record<string, unknown>>(linhas: T[], termo: string, colunas?: string[]) {
  if (!termo.trim()) return linhas;
  return linhas.filter((linha) => combina(colunas ? colunas.map((coluna) => linha[coluna]) : Object.values(linha), termo));
}
