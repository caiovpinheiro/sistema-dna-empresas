import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Senha do colaborador no app do ponto (tabela dna_work.candidato), gravada só em Argon2id (senha_hash), com salt
 * aleatório próprio de cada senha dentro do próprio hash, como a do portal da empresa.
 * O MD5 antigo (coluna "senha") não é mais gravado: quem ainda só tem ele entra uma última vez por ele, ganha o
 * Argon2id e o MD5 é apagado.
 */
type Executor = { query: (sql: string, valores?: unknown[]) => Promise<unknown> };

export const SENHA_MINIMA = 6;

export async function senhaConfere(linha: { senha: string | null; senha_hash: string | null }, senha: string) {
  if (linha.senha_hash) {
    try {
      if (await verify(linha.senha_hash, senha)) return { ok: true, temHash: true };
    } catch {
      // Hash inválido: cai para o MD5 antigo.
    }
  }
  const legado = (linha.senha ?? "").toLowerCase();
  const ok = /^[a-f0-9]{32}$/.test(legado) && createHash("md5").update(senha).digest("hex") === legado;
  return { ok, temHash: false };
}

/** Grava a senha. Provisória (criada ou redefinida pela empresa) obriga a pessoa a trocar no próximo login. */
export async function gravarSenha(db: Executor, idCandidato: string, senha: string, provisoria: boolean) {
  await db.query(
    "update dna_work.candidato set senha_hash = $2, senha = null, atualiza_senha = $3, data_senha = $4 where id_candidato = $1",
    [idCandidato, await hash(senha), provisoria ? 1 : 0, hojeLegado()],
  );
}

/** Quem entrou pelo MD5 antigo: passa para o Argon2id e o MD5 é apagado, sem mexer em mais nada. */
export async function guardarHash(db: Executor, idCandidato: string, senha: string) {
  await db.query("update dna_work.candidato set senha_hash = $2, senha = null where id_candidato = $1", [idCandidato, await hash(senha)]);
}

function hojeLegado() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).replaceAll("-", "/");
}
