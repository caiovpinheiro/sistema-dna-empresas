import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * Regras para a empresa cadastrada pelo portal ficar igual a uma cadastrada pelo sistema interno.
 * sede 10 = cliente desta unidade da DNA (sem ela a vaga não entra na triagem e a empresa não é cobrada).
 * usa_asaas 1 = a própria empresa recebe o boleto do Asaas (sem ele a empresa fica fora do faturamento).
 */
export const SEDE_DNA = 10;
export const USA_ASAAS = 1;

type Endereco = { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null };

export type Ponto = { lat: number; lng: number };

/** Mesmo texto que o interno grava em razao_sem_acento e fantasia_sem_acento: tira o acento, mantém maiúsculas e minúsculas. */
export function semAcento(valor: string) {
  return valor.normalize("NFD").replace(/\p{M}/gu, "");
}

/** "Bairro - Cidade / UF", o formato de public.empresa.local. Cópia de sistema-dna-v1/backend/src/lib/empresa-endereco.ts. */
export function localDaEmpresa(bairro: string, cidade: string, uf: string) {
  const cidadeUf = `${cidade.trim()} / ${uf.trim().toUpperCase()}`;
  return bairro.trim() ? `${bairro.trim()} - ${cidadeUf}` : cidadeUf;
}

/** "Rua X, 123 - Bairro, Cidade - UF, 00000-000, Brasil". Cópia de sistema-dna-v1/backend/src/lib/empresa-endereco.ts. */
export function enderecoParaGeocode(partes: Endereco) {
  const limpo = (valor: string | null | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();
  const rua = [limpo(partes.logradouro), limpo(partes.numero)].filter(Boolean).join(", ");
  const cidadeUf = [limpo(partes.cidade), limpo(partes.uf).toUpperCase()].filter(Boolean).join(" - ");
  const digitos = limpo(partes.cep).replace(/\D/g, "");
  const cep = digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : "";
  const trechos = [[rua, limpo(partes.bairro)].filter(Boolean).join(" - "), cidadeUf, cep].filter(Boolean);
  return rua && cidadeUf ? `${trechos.join(", ")}, Brasil` : "";
}

/**
 * Latitude e longitude pelo endereço completo; sem resultado, pelo CEP. Null quando o Google não acha.
 * Cópia de geocodeEndereco (sistema-dna-v1/backend/src/lib/empresa-endereco.ts). A chave só é usada no servidor.
 */
export async function geocodeEndereco(apiKey: string, cep: string, endereco?: Endereco): Promise<Ponto | null> {
  const completo = endereco ? enderecoParaGeocode({ ...endereco, cep }) : "";
  for (const busca of [completo, cep].filter(Boolean)) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", busca);
    url.searchParams.set("components", "country:BR");
    url.searchParams.set("region", "br");
    url.searchParams.set("key", apiKey);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controle.signal });
      const body = await response.json() as { status?: string; results?: Array<{ geometry?: { location?: Ponto } }> };
      const location = body.results?.[0]?.geometry?.location;
      if (response.ok && location && body.status === "OK") return { lat: location.lat, lng: location.lng };
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Geocode que nunca derruba o cadastro: sem chave, sem resposta ou erro de rede devolvem null (empresa fica pendente). */
export async function localizar(apiKey: string, endereco: Endereco & { cep: string }): Promise<{ ponto: Ponto | null; motivo: string | null }> {
  if (!apiKey) return { ponto: null, motivo: "GOOGLE_MAPS_API_KEY ausente" };
  try {
    const ponto = await geocodeEndereco(apiKey, endereco.cep.replace(/\D/g, ""), endereco);
    return ponto ? { ponto, motivo: null } : { ponto: null, motivo: "Google não localizou o endereço" };
  } catch (error) {
    return { ponto: null, motivo: `falha no geocode: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** CNPJ já cadastrado em public.empresa (só números) ou em dna_work.empresa (com máscara). */
export async function empresaPorCnpj(client: Pick<PoolClient, "query">, digitos: string) {
  const triagem = await client.query<{ id: string }>(
    "select id::text as id from public.empresa where regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $1 limit 1",
    [digitos],
  );
  if (triagem.rows[0]) return { id: triagem.rows[0].id, noInterno: true };
  const ficha = await client.query<{ id: string }>(
    "select id_empresa::text as id from dna_work.empresa where regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $1 limit 1",
    [digitos],
  );
  return ficha.rows[0] ? { id: ficha.rows[0].id, noInterno: false } : null;
}

/**
 * Grupo do responsável: e-mail igual (sem maiúsculas e sem espaços nas pontas) ou telefone igual (só números).
 * Sem nenhum, cria um grupo com o nome fantasia da empresa e os contatos do responsável.
 */
export async function acharOuCriarGrupo(client: PoolClient, dados: { nome: string; email: string; telefone: string }) {
  const email = dados.email.trim().toLowerCase();
  const telefone = dados.telefone.replace(/\D/g, "");
  const achado = await client.query<{ id: string }>(`
    select id::text as id from public.grupo
    where ($1 <> '' and lower(btrim(coalesce(email, ''))) = $1)
       or ($2 <> '' and regexp_replace(coalesce(telefone, ''), '\\D', '', 'g') = $2)
    order by case when $1 <> '' and lower(btrim(coalesce(email, ''))) = $1 then 0 else 1 end, criado_em
    limit 1
  `, [email, telefone]);
  if (achado.rows[0]) return { id: achado.rows[0].id, criado: false };
  const id = randomUUID();
  await client.query(
    "insert into public.grupo (id, nome, email, telefone) values ($1, $2, $3, $4)",
    [id, dados.nome, email || null, telefone || null],
  );
  return { id, criado: true };
}

export type EmpresaParaInterno = {
  id: string;
  grupoId: string;
  cnpjDigitos: string;
  razao: string;
  fantasia: string;
  email: string | null;
  telefone: string | null;
  cep: string;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  ponto: Ponto;
};

/** public.empresa: a linha que liga a empresa ao grupo e que a triagem lê para medir a distância. */
export async function gravarEmpresaNaTriagem(client: PoolClient, empresa: EmpresaParaInterno) {
  await client.query(`
    insert into public.empresa (
      id, grupo_id, cnpj, razao_social, nome_fantasia, email, telefone, cep, logradouro, numero, complemento, latitude, longitude, local
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    empresa.id, empresa.grupoId, empresa.cnpjDigitos, empresa.razao, empresa.fantasia, empresa.email, empresa.telefone,
    empresa.cep, empresa.logradouro, empresa.numero, empresa.complemento, empresa.ponto.lat, empresa.ponto.lng,
    localDaEmpresa(empresa.bairro, empresa.cidade, empresa.uf),
  ]);
}

/** Duas linhas por empresa nova em dna_work.assinaturas_empresa; pula se a empresa já tiver. */
export async function gravarAssinaturasEmpresa(client: PoolClient, idEmpresa: string) {
  const tem = await client.query("select 1 from dna_work.assinaturas_empresa where id_empresa = $1 limit 1", [idEmpresa]);
  if (tem.rowCount) return;
  await client.query(`
    insert into dna_work.assinaturas_empresa (id_empresa, tipo, responsavel, administrativo, rh, financeiro, supervisor)
    values ($1,'TCE',0,0,0,0,0), ($1,'Convenio',0,0,0,0,0)
  `, [idEmpresa]);
}

/** Valores de cobrança padrão da vaga, iguais aos que a "Nova vaga" do interno grava. */
export async function gravarValoresPadraoDaVaga(client: PoolClient, comparador: string) {
  await client.query(`
    insert into dna_work.vaga_valores (
      comparador, cobra_selecao, tipo_selecao, valor_selecao, cobra_recorrente, tipo_recorrente, valor_recorrente,
      pro_rata, cobra_comissao, tipo_comissao, valor_comissao, treinamento, tipo_treinamento, valor_treinamento
    ) values ($1,0,'F','',0,'0','','0',0,'P','0',0,'F','0')
  `, [comparador]);
}
