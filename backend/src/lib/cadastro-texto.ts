export const TERMO_VERSAO = "2026-11-09";

const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);

export type Modalidade = "clt" | "estagio";

export type Clausula = { titulo: string; texto: string };

export const TERMOS = {
  versao: TERMO_VERSAO,
  titulo: "Termos gerais de prestação de serviços",
  aviso: "O cadastro não gera cobrança. Taxas de recrutamento e de estágio, quando existirem, são definidas pela DNA Work e apresentadas antes de qualquer faturamento.",
  clausulas: [
    { titulo: "1. Objeto e modalidades", texto: "A DNA Work presta recrutamento, triagem, seleção e encaminhamento de candidatos para vagas CLT e de estágio informadas pela empresa." },
    { titulo: "2. Cobranças", texto: "Não há taxa de adesão para abrir a vaga neste cadastro. Nenhum boleto é emitido agora. A taxa de recrutamento da contratação CLT e, no estágio, a taxa de recrutamento e a taxa administrativa são as registradas pela DNA Work, nunca um valor digitado neste formulário." },
    { titulo: "3. Responsabilidades", texto: "A empresa declara que as condições da vaga são verdadeiras e que cumprirá a legislação trabalhista ou de estágio aplicável." },
    { titulo: "4. Dados e confidencialidade", texto: "Os dados pessoais informados são tratados para criar o acesso ao portal, a empresa e a vaga, conforme a legislação brasileira." },
    { titulo: "5. Estágio", texto: "O aceite eletrônico não substitui o Termo de Compromisso de Estágio firmado entre empresa, estudante e instituição de ensino." },
    { titulo: "6. Registro", texto: "O aceite guarda a versão do termo, a data e a hora, o IP, o responsável e as condições da modalidade escolhida, e gera um comprovante." },
  ] satisfies Clausula[],
  modalidades: {
    clt: {
      titulo: "Condições comerciais — contratação CLT",
      itens: [
        "Abertura da vaga: sem taxa de adesão.",
        "Taxa de recrutamento: definida pela DNA Work e informada antes de qualquer cobrança.",
        "Este cadastro não emite boleto e não ativa cobrança automática.",
      ],
    },
    estagio: {
      titulo: "Condições comerciais — estágio",
      itens: [
        "Abertura da vaga: sem taxa de adesão.",
        "Taxa de recrutamento e taxa administrativa do estágio: definidas pela DNA Work e informadas antes de qualquer cobrança.",
        "O aceite eletrônico não substitui o Termo de Compromisso de Estágio.",
        "Este cadastro não emite boleto e não ativa cobrança automática.",
      ],
    },
  },
};

export type EmpresaCadastro = {
  cnpj: string;
  razao: string;
  fantasia: string;
  telefone: string;
  nome: string;
  cargo: string;
  email: string;
  telefoneResponsavel: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type VagaCadastro = {
  modalidade: Modalidade;
  cargo: string;
  quantidade: number;
  salario: string;
  beneficios: string;
  jornada: string;
  endereco: string;
  cidade: string;
  uf: string;
  atividades: string;
};

export type CadastroValido = {
  empresa: EmpresaCadastro;
  vaga: VagaCadastro;
  versao: string;
};

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function limparTexto(valor: unknown, maximo: number): string {
  return textoBruto(valor).slice(0, maximo);
}

function textoBruto(valor: unknown): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatarCnpj(digitos: string): string {
  const d = digitos.slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatarTelefone(digitos: string): string {
  const d = digitos.slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export function formatarCep(digitos: string): string {
  const d = digitos.slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}

export function cnpjValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const digito = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((total, numero, indice) => total + Number(numero) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(d.slice(0, 12) + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${primeiro}${segundo}`);
}

export function emailValido(valor: string): boolean {
  if (valor.length < 6 || valor.length > 255) return false;
  if (valor.includes(" ") || (valor.match(/@/g) ?? []).length !== 1) return false;
  const [local, dominio] = valor.split("@");
  if (!local || !dominio || local.length > 64 || dominio.length > 190) return false;
  if (local.startsWith(".") || local.endsWith(".") || dominio.startsWith(".") || dominio.endsWith(".")) return false;
  return /^[A-Za-z0-9._%+-]+$/.test(local) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(dominio);
}

function telefoneValido(digitos: string): boolean {
  return digitos.length === 10 || digitos.length === 11;
}

function salarioValido(valor: string): boolean {
  return /^(\d{1,3}(\.\d{3})+|\d{1,7})(,\d{2})?$/.test(valor);
}

function lerObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
}

export function validarCadastro(body: unknown): { dados: CadastroValido | null; erros: Record<string, string> } {
  const raiz = lerObjeto(body);
  const empresa = lerObjeto(raiz.empresa);
  const vaga = lerObjeto(raiz.vaga);
  const aceite = lerObjeto(raiz.aceite);
  const erros: Record<string, string> = {};
  const limitar = (valor: unknown, maximo: number, chave: string, rotulo: string) => {
    const bruto = textoBruto(valor);
    if (bruto.length > maximo) erros[chave] = `${rotulo} aceita no máximo ${maximo} caracteres.`;
    return bruto.slice(0, maximo);
  };

  const cnpjInformado = textoBruto(empresa.cnpj);
  if (cnpjInformado.length > 18) erros["empresa.cnpj"] = "O CNPJ aceita no máximo 18 caracteres.";
  const cnpjDigitos = somenteDigitos(cnpjInformado);
  if (cnpjDigitos.length > 14) erros["empresa.cnpj"] = "O CNPJ aceita 14 números.";
  const cnpj = formatarCnpj(cnpjDigitos);
  if (!erros["empresa.cnpj"] && !cnpjValido(cnpjDigitos)) erros["empresa.cnpj"] = "Informe um CNPJ válido com 14 números.";

  const razao = limitar(empresa.razao, 255, "empresa.razao", "A razão social");
  if (!erros["empresa.razao"] && razao.length < 2) erros["empresa.razao"] = "Informe a razão social.";

  const fantasia = limitar(empresa.fantasia, 255, "empresa.fantasia", "O nome fantasia");
  const telefoneBruto = textoBruto(empresa.telefone);
  const telefoneDigitos = somenteDigitos(telefoneBruto);
  if (telefoneBruto.length > 15 || telefoneDigitos.length > 11) erros["empresa.telefone"] = "O telefone comercial aceita DDD e no máximo 11 números.";
  else if (!telefoneValido(telefoneDigitos)) erros["empresa.telefone"] = "Informe o telefone comercial com DDD e 10 ou 11 números.";

  const nome = limitar(empresa.nome, 150, "empresa.nome", "O nome do responsável");
  if (!erros["empresa.nome"] && (nome.length < 5 || !nome.includes(" "))) erros["empresa.nome"] = "Informe o nome e o sobrenome do responsável.";

  const cargoResp = limitar(empresa.cargo, 80, "empresa.cargo", "O cargo do responsável");
  if (!erros["empresa.cargo"] && cargoResp.length < 2) erros["empresa.cargo"] = "Informe o cargo do responsável.";

  const email = textoBruto(empresa.email).toLowerCase();
  if (email.length > 255) erros["empresa.email"] = "O e-mail aceita no máximo 255 caracteres.";
  else if (!email.includes("@")) erros["empresa.email"] = "O e-mail precisa ter @.";
  else if (!emailValido(email)) erros["empresa.email"] = "Informe um e-mail válido, como nome@empresa.com.br.";

  const telefoneRespBruto = textoBruto(empresa.telefoneResponsavel);
  const telefoneRespDigitos = somenteDigitos(telefoneRespBruto);
  if (telefoneRespBruto.length > 15 || telefoneRespDigitos.length > 11) erros["empresa.telefoneResponsavel"] = "O telefone do responsável aceita DDD e no máximo 11 números.";
  else if (!telefoneValido(telefoneRespDigitos)) erros["empresa.telefoneResponsavel"] = "Informe o telefone do responsável com DDD e 10 ou 11 números.";

  const cepBruto = textoBruto(empresa.cep);
  const cepDigitos = somenteDigitos(cepBruto);
  if (cepBruto.length > 9 || cepDigitos.length > 8) erros["empresa.cep"] = "O CEP aceita 8 números.";
  else if (cepDigitos.length !== 8) erros["empresa.cep"] = "Informe o CEP com 8 números.";

  const logradouro = limitar(empresa.logradouro, 255, "empresa.logradouro", "O logradouro");
  if (!erros["empresa.logradouro"] && logradouro.length < 2) erros["empresa.logradouro"] = "Informe o logradouro.";

  const numero = limitar(empresa.numero, 10, "empresa.numero", "O número");
  if (!erros["empresa.numero"] && !/^[0-9A-Za-z/-]{1,10}$/.test(numero)) erros["empresa.numero"] = "Informe o número com até 10 caracteres, ou S/N.";

  const complemento = limitar(empresa.complemento, 100, "empresa.complemento", "O complemento");
  const bairro = limitar(empresa.bairro, 50, "empresa.bairro", "O bairro");
  if (!erros["empresa.bairro"] && bairro.length < 2) erros["empresa.bairro"] = "Informe o bairro com até 50 caracteres.";

  const cidade = limitar(empresa.cidade, 100, "empresa.cidade", "A cidade");
  if (!erros["empresa.cidade"] && cidade.length < 2) erros["empresa.cidade"] = "Informe a cidade.";

  const ufBruta = textoBruto(empresa.uf);
  if (ufBruta.length > 2) erros["empresa.uf"] = "A UF aceita 2 letras.";
  const uf = ufBruta.slice(0, 2).toUpperCase();
  if (!erros["empresa.uf"] && !UFS.has(uf)) erros["empresa.uf"] = "Informe a UF com 2 letras.";

  const modalidade = textoBruto(vaga.modalidade).toLowerCase();
  if (modalidade.length > 10 || (modalidade !== "clt" && modalidade !== "estagio")) erros["vaga.modalidade"] = "Escolha CLT ou estágio.";

  const cargo = limitar(vaga.cargo, 180, "vaga.cargo", "O cargo da vaga");
  if (!erros["vaga.cargo"] && cargo.length < 2) erros["vaga.cargo"] = "Informe o cargo da vaga.";

  const quantidadeTexto = textoBruto(vaga.quantidade);
  const quantidade = Number(quantidadeTexto);
  if (quantidadeTexto.length > 3 || !/^\d{1,3}$/.test(quantidadeTexto) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 999) {
    erros["vaga.quantidade"] = "Informe a quantidade de 1 a 999.";
  }

  const salario = textoBruto(vaga.salario);
  if (salario.length > 20) erros["vaga.salario"] = "O salário ou a bolsa aceita no máximo 20 caracteres.";
  else if (!salarioValido(salario)) erros["vaga.salario"] = "Informe o salário ou a bolsa apenas com números, como 1.850,00.";

  const beneficios = limitar(vaga.beneficios, 255, "vaga.beneficios", "Os benefícios");
  const jornada = limitar(vaga.jornada, 255, "vaga.jornada", "A jornada");
  if (!erros["vaga.jornada"] && jornada.length < 3) erros["vaga.jornada"] = "Descreva a jornada em até 255 caracteres.";

  const endereco = limitar(vaga.endereco, 255, "vaga.endereco", "O endereço de trabalho");
  if (!erros["vaga.endereco"] && endereco.length < 3) erros["vaga.endereco"] = "Informe o endereço de trabalho com até 255 caracteres.";

  const cidadeVaga = limitar(vaga.cidade, 100, "vaga.cidade", "A cidade da vaga");
  if (!erros["vaga.cidade"] && cidadeVaga.length < 2) erros["vaga.cidade"] = "Informe a cidade da vaga.";

  const ufVagaBruta = textoBruto(vaga.uf);
  if (ufVagaBruta.length > 2) erros["vaga.uf"] = "A UF da vaga aceita 2 letras.";
  const ufVaga = ufVagaBruta.slice(0, 2).toUpperCase();
  if (!erros["vaga.uf"] && !UFS.has(ufVaga)) erros["vaga.uf"] = "Informe a UF da vaga com 2 letras.";

  const atividades = limitar(vaga.atividades, 2000, "vaga.atividades", "As atividades");
  if (!erros["vaga.atividades"] && atividades.length < 10) erros["vaga.atividades"] = "Descreva as atividades em pelo menos 10 caracteres.";

  if (aceite.termos !== true) erros["aceite.termos"] = "Leia e aceite os termos para concluir.";
  if (aceite.poderes !== true) erros["aceite.poderes"] = "Confirme que você pode representar a empresa.";
  const versao = limparTexto(aceite.versao, 40);
  if (versao !== TERMO_VERSAO) erros["aceite.versao"] = "Os termos foram atualizados. Leia a versão atual antes de aceitar.";

  if (Object.keys(erros).length) return { dados: null, erros };
  return {
    dados: {
      versao,
      empresa: {
        cnpj,
        razao,
        fantasia,
        telefone: formatarTelefone(telefoneDigitos),
        nome,
        cargo: cargoResp,
        email,
        telefoneResponsavel: formatarTelefone(telefoneRespDigitos),
        cep: formatarCep(cepDigitos),
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        uf,
      },
      vaga: {
        modalidade: modalidade as Modalidade,
        cargo,
        quantidade,
        salario,
        beneficios,
        jornada,
        endereco,
        cidade: cidadeVaga,
        uf: ufVaga,
        atividades,
      },
    },
    erros: {},
  };
}

export function condicoesDaModalidade(modalidade: Modalidade): string {
  const bloco = TERMOS.modalidades[modalidade];
  return [bloco.titulo, ...bloco.itens, TERMOS.aviso].join("\n");
}
