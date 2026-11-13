/** "2026/11/03", "2026-11-03" ou "03/11/2026" → "03/11/2026". Outros formatos voltam como vieram. */
export function dataBr(valor?: string | number | null) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "—";
  const iso = texto.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return texto;
}

/** Data do sistema antigo como Date (meia-noite local), ou null. */
export function paraData(valor?: string | number | null) {
  const texto = String(valor ?? "").trim();
  const iso = texto.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  return null;
}

/** "há 3 dias", "hoje"… a partir de uma data do sistema antigo. */
export function haQuantoTempo(valor?: string | number | null) {
  const data = paraData(valor);
  if (!data) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje.getTime() - data.getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  if (dias < 60) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses < 24 ? `há ${meses} meses` : `há ${Math.floor(meses / 12)} anos`;
}

/** "1500,00", "1500.5", "R$ 1.500,00" → "R$ 1.500,00". Texto que não é número volta como veio. */
export function dinheiro(valor?: string | number | null) {
  const texto = String(valor ?? "").replace(/R\$|\s/g, "").trim();
  if (!texto) return "—";
  let normal = texto;
  if (texto.includes(",")) normal = texto.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) normal = texto.replace(/\./g, "");
  const numero = Number(normal);
  if (!Number.isFinite(numero) || normal === "") return String(valor);
  if (numero === 0) return "A combinar";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function primeiroNome(nome?: string | null) {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
}

export function iniciais(nome?: string | null) {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
}
