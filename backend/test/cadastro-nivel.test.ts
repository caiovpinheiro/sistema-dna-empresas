import assert from "node:assert/strict";
import test from "node:test";
import { TERMO_VERSAO, escolaridadeDoNivel, textoDoNivel, validarCadastro } from "../src/lib/cadastro-texto.js";

function corpo(vaga: Record<string, unknown>) {
  return {
    empresa: {
      cnpj: "11.222.333/0001-81", razao: "Empresa Teste Ltda", fantasia: "Teste", telefone: "(11) 3333-4444",
      nome: "Ana Souza", cargo: "RH", email: "ana@empresa.com.br", telefoneResponsavel: "(11) 99999-8888",
      cep: "01310-100", logradouro: "Av. Paulista", numero: "1000", complemento: "", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP",
    },
    vaga: {
      modalidade: "estagio", cargo: "Estagiário de RH", quantidade: 2, salario: "1.200,00", beneficios: "", jornada: "Segunda a sexta, 9h às 15h",
      endereco: "Av. Paulista, 1000", cidade: "São Paulo", uf: "SP", atividades: "Apoio nas rotinas de recrutamento.", ...vaga,
    },
    aceite: { termos: true, poderes: true, versao: TERMO_VERSAO },
  };
}

test("estágio exige escolher o nível de ensino", () => {
  const { erros } = validarCadastro(corpo({}));
  assert.equal(erros["vaga.nivelEnsino"], "Escolha se o estágio é para ensino médio, superior ou os dois.");
  assert.ok(validarCadastro(corpo({ nivelEnsino: "fundamental" })).erros["vaga.nivelEnsino"]);
});

test("estágio guarda médio, superior ou os dois", () => {
  for (const nivel of ["medio", "superior", "ambos"] as const) {
    const { dados, erros } = validarCadastro(corpo({ nivelEnsino: nivel }));
    assert.deepEqual(erros, {});
    assert.equal(dados?.vaga.nivelEnsino, nivel);
  }
});

test("CLT não pede nem guarda nível de estágio", () => {
  const { dados, erros } = validarCadastro(corpo({ modalidade: "clt", nivelEnsino: "medio" }));
  assert.deepEqual(erros, {});
  assert.equal(dados?.vaga.nivelEnsino, null);
});

test("nível vira o código de escolaridade do interno e um texto para a equipe", () => {
  assert.equal(escolaridadeDoNivel("medio"), "31");
  assert.equal(escolaridadeDoNivel("ambos"), "31");
  assert.equal(escolaridadeDoNivel("superior"), null);
  assert.equal(escolaridadeDoNivel(null), null);
  assert.equal(textoDoNivel("medio"), "Estágio para estudantes do ensino médio.");
  assert.equal(textoDoNivel("superior"), "Estágio para estudantes do ensino superior.");
  assert.equal(textoDoNivel("ambos"), "Estágio para estudantes do ensino médio ou superior.");
  assert.equal(textoDoNivel(null), "");
});
