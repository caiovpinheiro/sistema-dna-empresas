import { createHash, randomBytes, randomInt } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import {
  TERMOS,
  cnpjValido,
  condicoesDaModalidade,
  formatarCep,
  formatarCnpj,
  limparTexto,
  somenteDigitos,
  validarCadastro,
  type Modalidade,
  escolaridadeDoNivel,
  textoDoNivel,
} from "../lib/cadastro-texto.js";

const MENU = "9%34%35%37";
const SUB1 = "146%203%206";
const SUB2 = "47%51%52%86%89";

type Receita = {
  razao_social?: string;
  nome_fantasia?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
};

export type ConsultaCnpj = {
  existe: boolean;
  consulta: boolean;
  cnpj: string;
  razao: string;
  fantasia: string;
  telefone: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type CadastroConcluido = {
  empresaId: string;
  vagaId: string;
  email: string;
  senha: string;
  comprovante: string;
  aceitoEm: string;
  versao: string;
};

export class CadastroPublicoService {
  constructor(private readonly db: Pool) {}

  termos() {
    return TERMOS;
  }

  async consultarCnpj(cnpjInformado: string): Promise<ConsultaCnpj> {
    const digitos = somenteDigitos(limparTexto(cnpjInformado, 18));
    if (!cnpjValido(digitos)) throw new AppError(422, "CNPJ_INVALIDO", "Informe um CNPJ válido com 14 números.");
    const existe = await this.empresaExiste(digitos);
    const receita = await this.buscarReceita(digitos);
    const telefone = somenteDigitos(receita?.ddd_telefone_1 ?? "").slice(-11);
    return {
      existe,
      consulta: Boolean(receita),
      cnpj: formatarCnpj(digitos),
      razao: limparTexto(receita?.razao_social, 255),
      fantasia: limparTexto(receita?.nome_fantasia, 255),
      telefone,
      cep: formatarCep(somenteDigitos(receita?.cep ?? "").slice(0, 8)),
      logradouro: limparTexto(receita?.logradouro, 255),
      numero: limparTexto(receita?.numero, 10),
      complemento: limparTexto(receita?.complemento, 100),
      bairro: limparTexto(receita?.bairro, 50),
      cidade: limparTexto(receita?.municipio, 100),
      uf: limparTexto(receita?.uf, 2).toUpperCase(),
    };
  }

  async concluir(body: unknown, ip: string): Promise<CadastroConcluido> {
    const { dados, erros } = validarCadastro(body);
    if (!dados) throw new AppError(422, "VALIDACAO", "Revise os campos destacados.", erros);
    if (await this.empresaExiste(somenteDigitos(dados.empresa.cnpj))) {
      throw new AppError(409, "EMPRESA_EXISTENTE", "Este CNPJ já está cadastrado. Use o acesso do portal ou fale com a DNA Work.");
    }
    if (await this.emailExiste(dados.empresa.email)) {
      throw new AppError(409, "EMAIL_EM_USO", "Este e-mail já possui acesso ao portal.");
    }

    const empresaId = crypto.randomUUID();
    const vagaId = crypto.randomUUID();
    const usuarioId = crypto.randomUUID();
    const comparador = randomBytes(8).toString("hex");
    const senha = senhaInicial();
    const senhaHash = await hash(senha);
    const senhaLegada = createHash("md5").update(senha).digest("hex");
    const hoje = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    const comprovante = `DNA-${randomBytes(5).toString("hex").toUpperCase()}`;
    const condicoes = condicoesDaModalidade(dados.vaga.modalidade);
    const tipo = dados.vaga.modalidade === "estagio" ? 1 : 2;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        insert into dna_work.empresa (
          id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, celular, cep,
          logradouro, numero, complemento, bairro, cidade, uf, status, responsavel,
          tipo_empresa, recrutamento, ponto, data_adicao
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,1,$15,
          1,1,0, now()
        )
      `, [
        empresaId,
        dados.empresa.razao,
        dados.empresa.fantasia || dados.empresa.razao,
        dados.empresa.cnpj,
        dados.empresa.email,
        dados.empresa.telefone,
        dados.empresa.telefoneResponsavel,
        dados.empresa.cep,
        dados.empresa.logradouro,
        dados.empresa.numero,
        dados.empresa.complemento || null,
        dados.empresa.bairro,
        dados.empresa.cidade,
        dados.empresa.uf,
        dados.empresa.nome,
      ]);
      await client.query(`
        insert into dna_work.vaga (
          id_vaga, id_empresa, cargo, tipo_vaga, salario, cidade, status, dataabertura, comparador,
          quantidade_posicoes, beneficios, beneficios_texto, texto_carga, atribuicaoes, requisitos_desejaveis,
          publicar, sexo, sede, codigo, escolaridade, data_adicao
        ) values (
          $1,$2,$3,$4,$5,$6,0,$7,$8,
          $9,$10,$11,$12,$13,$14,
          1,'I',10,$15,$16, now()
        )
      `, [
        vagaId,
        empresaId,
        dados.vaga.cargo,
        tipo,
        dados.vaga.salario,
        dados.vaga.cidade,
        hoje,
        comparador,
        dados.vaga.quantidade,
        dados.vaga.beneficios || null,
        dados.vaga.beneficios || null,
        dados.vaga.jornada,
        dados.vaga.atividades,
        // Estágio: a escolha de nível (médio, superior ou os dois) abre os requisitos, para a equipe ver no interno.
        [textoDoNivel(dados.vaga.nivelEnsino), dados.vaga.atividades].filter(Boolean).join(" ").slice(0, 255),
        `P${Date.now().toString(36).slice(-8)}`.slice(0, 20),
        escolaridadeDoNivel(dados.vaga.nivelEnsino),
      ]);
      await client.query(`
        insert into dna_work.vaga_endereco (comparador, logradouro, numero, complemento, bairro, cidade, uf, cep, empresa)
        values ($1,$2,$3,$4,$5,$6,$7,$8,0)
      `, [
        comparador,
        dados.vaga.endereco,
        dados.empresa.numero,
        dados.empresa.complemento || null,
        dados.empresa.bairro,
        dados.vaga.cidade,
        dados.vaga.uf,
        dados.empresa.cep,
      ]);
      await client.query(`
        insert into dna_work.etapa_vaga (
          id_vaga, avalia_comportamental, avalia_cultural, avalia_escolar, avalia_tecnico, avalia_basico, avalia_cargo,
          entrevista_agente, entrevista_agente_tipo, entrevista_empresa, entrevista_empresa_tipo, contratacao, convocacao_automatica
        ) values ($1,1,0,0,0,1,0,1,'P',1,'V','T',1)
      `, [vagaId]);
      await client.query(`
        insert into dna_work.usuario_empresa
          (id_u, nome_u, email_u, senha_u, senha_hash, telefone_u, empresa_u, status, tipo, data_senha, atualiza_senha)
        values ($1,$2,$3,$4,$5,$6,$7,1,1,$8,1)
      `, [
        usuarioId,
        dados.empresa.nome,
        dados.empresa.email,
        senhaLegada,
        senhaHash,
        somenteDigitos(dados.empresa.telefoneResponsavel).slice(0, 11),
        empresaId,
        hoje,
      ]);
      await client.query(
        `insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa) values ($1,$2)`,
        [usuarioId, empresaId],
      );
      await client.query(`
        insert into dna_work.paginas_usuario_empresa (id_usuario, menu, sub1, sub2, paginas)
        values ($1,$2,$3,$4,'')
      `, [usuarioId, MENU, SUB1, SUB2]);
      const aceito = await client.query<{ aceito_em: Date }>(`
        insert into dna_work.cadastro_empresa_aceite (
          id, id_empresa, id_vaga, id_usuario, versao, modalidade, condicoes,
          responsavel, cargo, email, ip, comprovante
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        returning aceito_em
      `, [
        crypto.randomUUID(),
        empresaId,
        vagaId,
        usuarioId,
        dados.versao,
        dados.vaga.modalidade,
        condicoes,
        dados.empresa.nome,
        dados.empresa.cargo,
        dados.empresa.email,
        ip.slice(0, 64),
        comprovante,
      ]);
      await client.query(
        `insert into dna_work.log_diversos (usuario, id_empresa, id_vaga, acao, data) values ($1,$2,$3,$4, now())`,
        [dados.empresa.nome.slice(0, 40), empresaId, vagaId, "Cadastro publico"],
      );
      await client.query("COMMIT");
      return {
        empresaId,
        vagaId,
        email: dados.empresa.email,
        senha,
        comprovante,
        aceitoEm: aceito.rows[0].aceito_em.toISOString(),
        versao: dados.versao,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "42P01") {
        throw new AppError(503, "MIGRACAO_PENDENTE", "O registro do aceite ainda não está disponível nesta base.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async empresaExiste(digitos: string): Promise<boolean> {
    const achou = await this.db.query(
      `select 1 from dna_work.empresa where regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $1 limit 1`,
      [digitos],
    );
    return achou.rowCount !== 0;
  }

  private async emailExiste(email: string): Promise<boolean> {
    const achou = await this.db.query(
      `select 1 from dna_work.usuario_empresa where lower(email_u) = $1 limit 1`,
      [email],
    );
    return achou.rowCount !== 0;
  }

  private async buscarReceita(digitos: string): Promise<Receita | null> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 8000);
    try {
      const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, {
        signal: controle.signal,
        headers: { accept: "application/json", "user-agent": "DNAWorkPortal/1.0" },
      });
      if (!resposta.ok) return null;
      return await resposta.json() as Receita;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function senhaInicial(): string {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const numeros = "23456789";
  const caracteres = [
    ...Array.from({ length: 8 }, () => letras[randomInt(letras.length)]),
    ...Array.from({ length: 4 }, () => numeros[randomInt(numeros.length)]),
  ];
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}

export type { Modalidade };
