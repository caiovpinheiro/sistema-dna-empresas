import crypto from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { cpfValido, dataIsoValida, proximoId } from "../lib/validacao.js";
import { problemaNasFerias, somarDias } from "../lib/ferias.js";
import { postServico } from "../lib/servico.js";
import { SENHA_MINIMA, gravarSenha } from "../lib/senha-colaborador.js";
import { conferirPar, conferirSobreposicao } from "./ponto-colaborador.service.js";
import { SEDE_DNA, USA_ASAAS, gravarValoresPadraoDaVaga, semAcento } from "../lib/empresa-interno.js";
import { ABRANGENCIAS, dataNoAno, feriadosNacionais, isoDe, type Abrangencia } from "../lib/feriados.js";

/**
 * Diurno ou Noturno pelo horário, sem a pessoa escolher. Noturno quando a jornada passa da meia-noite (é assim que o ponto
 * decide de que dia é a saída) ou quando mais da metade dela cai entre 22h e 5h, o horário noturno da CLT (art. 73).
 */
function tipoDaJornada(entrada: string, saida: string): "Diurno" | "Noturno" {
  const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  const inicio = minutos(entrada);
  let fim = minutos(saida);
  if (fim <= inicio) fim += 24 * 60;
  if (fim > 24 * 60) return "Noturno";
  let noturnos = 0;
  for (let minuto = inicio; minuto < fim; minuto += 1) {
    const doDia = minuto % (24 * 60);
    if (doDia >= 22 * 60 || doDia < 5 * 60) noturnos += 1;
  }
  return noturnos * 2 > fim - inicio ? "Noturno" : "Diurno";
}

/** Dias da semana: chave do formulário/carga_horaria, coluna 1/0 em ponto_turno_base e rótulo curto. */
const DIAS_SEMANA = [
  { chave: "segunda", coluna: "segunda_feira", rotulo: "Seg" },
  { chave: "terca", coluna: "terca_feira", rotulo: "Ter" },
  { chave: "quarta", coluna: "quarta_feira", rotulo: "Qua" },
  { chave: "quinta", coluna: "quinta_feira", rotulo: "Qui" },
  { chave: "sexta", coluna: "sexta_feira", rotulo: "Sex" },
  { chave: "sabado", coluna: "sabado", rotulo: "Sáb" },
  { chave: "domingo", coluna: "domingo", rotulo: "Dom" },
] as const;

type CargaBase = {
  id: number; entrada: string | null; saida_refeicao: string | null; retorno_refeicao: string | null; saida: string | null;
  tolerancia: string | null; pausa: number | null; refeicao_livre: number | null; refeicao_minutos: number | null;
};

const COLUNAS_CARGA = "id, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa, refeicao_livre, refeicao_minutos";

/** Campos de carga_horaria na ordem de getUTCDay (0 = domingo). */
const CAMPOS_DA_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;

/** Jornada da pessoa num período: cada dia com o horário copiado (ver ponto_jornada_historico). */
type FotoJornada = Record<string, { trabalha: boolean; carga: CargaBase | null }>;

/** Almoço livre: só a duração é fixa; a pessoa sai e volta quando quiser dentro do expediente. */
const refeicaoLivre = (carga: CargaBase | undefined) => Boolean(carga && Number(carga.refeicao_livre) === 1 && Number(carga.refeicao_minutos) > 0);

/** "01:30" a partir de 90 minutos. */
const duracao = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

/** Horário de um dia a partir da carga. Sem pausa (ou com almoço livre), o sistema antigo grava a refeição igual à saída. */
function horarioDaCarga(carga: CargaBase) {
  const hhmm = (valor: string | null) => (valor ?? "").slice(0, 5);
  const livre = refeicaoLivre(carga);
  const pausa = livre || (Number(carga.pausa) === 1 && hhmm(carga.saida_refeicao) !== hhmm(carga.saida));
  return {
    entrada: hhmm(carga.entrada),
    saida: hhmm(carga.saida),
    pausa,
    refeicaoLivre: livre,
    duracaoRefeicao: livre ? duracao(Number(carga.refeicao_minutos)) : "",
    saidaRefeicao: pausa && !livre ? hhmm(carga.saida_refeicao) : "",
    retornoRefeicao: pausa && !livre ? hhmm(carga.retorno_refeicao) : "",
    tolerancia: (carga.tolerancia ?? "").trim() || "0",
  };
}

/** Minutos entre dois horários "HH:MM" (passa da meia-noite quando o fim é menor). */
function minutosEntre(inicio: string, fim: string) {
  const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  const total = minutos(fim) - minutos(inicio);
  return total < 0 ? total + 24 * 60 : total;
}

/**
 * Regras da lei para a jornada. Erro impede salvar; aviso só alerta (vale com acordo ou convenção coletiva).
 * - Estágio (Lei 11.788/2008, art. 10): até 6h por dia e 30h por semana.
 * - CLT: até 44h por semana (CF, art. 7º, XIII); dia acima de 8h só com acordo de compensação e nunca acima de 10h
 *   (art. 59); mais de 6h exige intervalo de 1h, que convenção coletiva pode reduzir até 30 min (arts. 71 e 611-A, III);
 *   entre 4h e 6h, 15 min de intervalo (art. 71, §1º); um dia de descanso na semana (art. 67).
 */
function regrasDaJornada(
  modalidade: "1" | "2",
  dias: Array<{ rotulo: string; trabalha: boolean; entrada: string; saida: string; pausa: boolean; refeicaoLivre: boolean; minutosRefeicao: number; saidaRefeicao: string; retornoRefeicao: string }>,
) {
  const erros: string[] = [];
  const avisos: string[] = [];
  let semana = 0;
  for (const dia of dias.filter((item) => item.trabalha)) {
    const intervalo = !dia.pausa ? 0 : dia.refeicaoLivre ? dia.minutosRefeicao : minutosEntre(dia.saidaRefeicao, dia.retornoRefeicao);
    if (dia.pausa && intervalo >= minutosEntre(dia.entrada, dia.saida)) {
      erros.push(`${dia.rotulo}: a refeição não pode ser maior que o expediente.`);
      continue;
    }
    const trabalhado = minutosEntre(dia.entrada, dia.saida) - intervalo;
    semana += trabalhado;
    if (intervalo > 120) avisos.push(`${dia.rotulo}: intervalo de refeição acima de 2 horas só vale com acordo escrito ou convenção coletiva (CLT, art. 71).`);
    const horas = `${Math.floor(trabalhado / 60)}h${trabalhado % 60 ? String(trabalhado % 60).padStart(2, "0") : ""}`;
    if (modalidade === "1") {
      if (trabalhado > 360) erros.push(`${dia.rotulo}: ${horas} de trabalho. Estágio pode ter no máximo 6 horas por dia (Lei 11.788/2008, art. 10).`);
      continue;
    }
    if (trabalhado > 600) erros.push(`${dia.rotulo}: ${horas} de trabalho. Pela CLT o dia não pode passar de 10 horas (art. 59).`);
    else if (trabalhado > 480) avisos.push(`${dia.rotulo}: ${horas} de trabalho. Mais de 8 horas no dia só vale com acordo de compensação de horas (CLT, art. 59, §2º).`);
    if (trabalhado > 360 && intervalo < 30) erros.push(`${dia.rotulo}: mais de 6 horas de trabalho exigem pelo menos 1 hora de intervalo para refeição (CLT, art. 71).`);
    else if (trabalhado > 360 && intervalo < 60) avisos.push(`${dia.rotulo}: intervalo menor que 1 hora só vale se a convenção ou o acordo coletivo permitir (CLT, art. 611-A, III).`);
    else if (trabalhado > 240 && trabalhado <= 360 && intervalo < 15) avisos.push(`${dia.rotulo}: entre 4 e 6 horas de trabalho, a lei exige 15 minutos de intervalo (CLT, art. 71, §1º).`);
  }
  const horasSemana = `${Math.floor(semana / 60)}h${semana % 60 ? String(semana % 60).padStart(2, "0") : ""}`;
  if (modalidade === "1" && semana > 1800) erros.push(`${horasSemana} por semana. Estágio pode ter no máximo 30 horas semanais (Lei 11.788/2008, art. 10).`);
  if (modalidade === "2" && semana > 2640) erros.push(`${horasSemana} por semana. Pela CLT o máximo é 44 horas semanais (Constituição, art. 7º, XIII).`);
  if (modalidade === "2" && dias.every((dia) => dia.trabalha)) erros.push("Sem nenhum dia de folga. A pessoa precisa de um descanso semanal de 24 horas (CLT, art. 67).");
  return { erros, avisos };
}

/**
 * Tolerância fixa da lei, igual para todas as empresas, por isso não se escolhe (CLT, art. 58, §1º): cada batida pode
 * variar até 5 minutos do horário previsto, somando no máximo 10 minutos no dia. Dentro disso, o dia não gera hora a menos
 * nem hora extra; a batida continua com o horário real (o ponto não pode trocar o horário marcado). Passou do limite,
 * conta a diferença inteira (Súmula 366 do TST). A Lei do Estágio não trata de tolerância; usa-se a mesma regra.
 */
const TOLERANCIA_POR_BATIDA = 5;
const TOLERANCIA_POR_DIA = 10;

function dentroDaTolerancia(batidas: Array<{ entrada: string | null; saida: string | null }>, carga: CargaBase | undefined) {
  if (!carga) return false;
  const horario = horarioDaCarga(carga);
  const doDia = TOLERANCIA_POR_DIA;
  const porBatida = TOLERANCIA_POR_BATIDA;
  if (horario.refeicaoLivre) {
    // Almoço livre: entrada e saída comparadas com o horário; a saída e a volta do almoço não têm hora certa, só a
    // duração. A diferença da duração conta pelas duas marcações do almoço (até 5 min cada, 10 no total).
    const feitas = batidas.flatMap((batida) => [batida.entrada, batida.saida]);
    if (feitas.length !== 4 || feitas.some((valor) => !valor)) return false;
    const [entrada, saiAlmoco, voltaAlmoco, saida] = feitas.map((valor) => segundosRelogio(valor));
    const previstaEntrada = segundosRelogio(horario.entrada);
    const previstaSaida = segundosRelogio(horario.saida);
    if ([entrada, saiAlmoco, voltaAlmoco, saida, previstaEntrada, previstaSaida].some((valor) => valor === null)) return false;
    const perto = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 24 * 3600 - d); };
    const difEntrada = perto(entrada!, previstaEntrada!);
    const difSaida = perto(saida!, previstaSaida!);
    let almoco = voltaAlmoco! - saiAlmoco!;
    if (almoco < 0) almoco += 24 * 3600;
    const difAlmoco = Math.abs(almoco - Number(carga.refeicao_minutos) * 60);
    if (difEntrada > porBatida * 60 || difSaida > porBatida * 60 || difAlmoco > 2 * porBatida * 60) return false;
    return difEntrada + difSaida + difAlmoco <= doDia * 60;
  }
  const previstas = horario.pausa ? [horario.entrada, horario.saidaRefeicao, horario.retornoRefeicao, horario.saida] : [horario.entrada, horario.saida];
  const feitas = batidas.flatMap((batida) => [batida.entrada, batida.saida]).filter((valor): valor is string => Boolean(valor));
  if (feitas.length !== previstas.length) return false;
  let soma = 0;
  for (let i = 0; i < previstas.length; i += 1) {
    // Em segundos: 5min30s já passa dos 5 minutos da lei.
    const prevista = segundosRelogio(previstas[i]);
    const feita = segundosRelogio(feitas[i]);
    if (prevista === null || feita === null) return false;
    let diferenca = Math.abs(feita - prevista);
    diferenca = Math.min(diferenca, 24 * 3600 - diferenca);
    if (diferenca > porBatida * 60) return false;
    soma += diferenca;
  }
  return soma <= doDia * 60;
}

/**
 * Soma de um período do relatório: horas feitas, previstas, saldo (em minutos, com sinal) e ocorrências.
 * Soma os segundos de verdade de cada dia e só arredonda no fim, para o arredondamento diário não se acumular.
 */
function resumoDoPeriodo(dias: Array<{ segundosFeitos: number; segundosCarga: number; saldoSegundos: number; segundosNoturnos: number; falta: boolean; incompleta: boolean; atestado: boolean; entrada1: string; alertaAlmoco: string }>) {
  const soma = (campo: "segundosFeitos" | "segundosCarga" | "saldoSegundos" | "segundosNoturnos") => paraMinutos(dias.reduce((total, dia) => total + dia[campo], 0));
  return {
    feitos: soma("segundosFeitos"),
    // Horas noturnas já reduzidas (52min30s = 1h), para o adicional noturno de 20% na folha (CLT, art. 73).
    noturnos: soma("segundosNoturnos"),
    previstos: soma("segundosCarga"),
    saldo: soma("saldoSegundos"),
    diasTrabalhados: dias.filter((dia) => dia.entrada1).length,
    faltas: dias.filter((dia) => dia.falta).length,
    incompletas: dias.filter((dia) => dia.incompleta).length,
    atestados: dias.filter((dia) => dia.atestado).length,
    // Dias com o almoço a menos de 1 hora da entrada ou da saída (ver alertaDoAlmoco).
    almocoPerto: dias.filter((dia) => dia.alertaAlmoco).length,
  };
}

/** "Seg a Sex 08:00–17:00 · Sáb 08:00–12:00": junta dias seguidos com o mesmo horário. */
function resumoDaJornada(dias: Array<{ rotulo: string; trabalha: boolean; horario: ReturnType<typeof horarioDaCarga> | null }>) {
  const grupos: Array<{ inicio: string; fim: string; texto: string }> = [];
  for (const dia of dias) {
    if (!dia.trabalha) continue;
    const texto = dia.horario
      ? `${dia.horario.entrada}–${dia.horario.saida}${dia.horario.refeicaoLivre ? ` (almoço livre de ${Number(dia.horario.duracaoRefeicao.slice(0, 2))}h${dia.horario.duracaoRefeicao.slice(3) === "00" ? "" : dia.horario.duracaoRefeicao.slice(3)})` : ""}`
      : "sem horário";
    const ultimo = grupos[grupos.length - 1];
    const anterior = dias[dias.indexOf(dia) - 1];
    if (ultimo && ultimo.texto === texto && anterior?.trabalha && anterior.rotulo === ultimo.fim) ultimo.fim = dia.rotulo;
    else grupos.push({ inicio: dia.rotulo, fim: dia.rotulo, texto });
  }
  return grupos.map((grupo) => `${grupo.inicio === grupo.fim ? grupo.inicio : `${grupo.inicio} a ${grupo.fim}`} ${grupo.texto}`).join(" · ");
}

function dataLegado(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${ano}/${mes}/${dia}` : iso;
}

/** Valor em reais no formato do sistema antigo ("1500,00"). Aceita 1500, 1.500, 1.500,00 e R$ 1500,5. */
function valorLegado(entrada: string) {
  let valor = entrada.replace(/R\$|\s/gi, "");
  if (!valor) return null;
  if (valor.includes(",")) {
    const [inteiro, centavos = ""] = valor.split(",");
    valor = `${inteiro.replace(/\./g, "")}.${centavos}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(valor)) {
    valor = valor.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(valor)) return null;
  return Number(valor).toFixed(2).replace(".", ",");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Código de "Ensino médio" em dna_work.flex: é o que o interno grava na vaga de estágio que aceita ensino médio. */
const ESCOLARIDADE_ENSINO_MEDIO = "31";
/** Códigos de status (sistema antigo) que a empresa pode cancelar: 0 aberta, 3 em análise, 5 liberar vaga, 8 pausada, 9 processo de venda. */
const STATUS_CANCELAVEL = [0, 3, 5, 8, 9];
/** 6 = cancelada, o código que a edição do interno grava para "fechada". */
const STATUS_CANCELADA = 6;

/** Mesmas regras da "Nova vaga" do interno, com mensagens por campo para o formulário do portal. */
function validarVaga(body: Record<string, string>) {
  const campos: Record<string, string> = {};
  const texto = (chave: string, limite = 4000) => String(body[chave] ?? "").trim().slice(0, limite);
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const tipo = Number(body.tipo);
  if (tipo === 4) throw new AppError(422, "TIPO_INDISPONIVEL", "Não abrimos mais vaga PJ.");
  if (![1, 2].includes(tipo)) throw new AppError(422, "TIPO_INVALIDO", "A vaga precisa ser estágio ou CLT.");
  const cargo = texto("cargo", 180);
  if (cargo.length < 2) campos.cargo = "Informe o cargo da vaga.";
  const quantidade = Number(body.quantidade || 1);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20) campos.quantidade = "Use um número de 1 a 20.";
  const salario = valorLegado(texto("salario", 40));
  if (!salario) campos.salario = "Informe o valor só com números, como 1.500,00.";
  const cargaHoraria = texto("cargaHoraria", 3);
  if (!(tipo === 1 ? ["20", "30"] : ["40", "44"]).includes(cargaHoraria)) campos.cargaHoraria = tipo === 1 ? "Estágio usa 20 ou 30 horas por semana." : "CLT usa 40 ou 44 horas por semana.";
  const entrada = texto("entrada", 5);
  const saida = texto("saida", 5);
  if (!hora.test(entrada)) campos.entrada = "Informe a entrada.";
  if (!hora.test(saida)) campos.saida = "Informe a saída.";
  let sabado: { entrada: string; saida: string } | null = null;
  if (body.sabado === "sim") {
    sabado = { entrada: texto("sabadoEntrada", 5), saida: texto("sabadoSaida", 5) };
    if (!hora.test(sabado.entrada) || !hora.test(sabado.saida)) campos.sabado = "Informe a entrada e a saída do sábado.";
  }
  const sexo = ["M", "F", "I"].includes(body.sexo) ? body.sexo : "I";
  const idade = Number(body.idade);
  const idadeAte = Number(body.idadeAte);
  if (!Number.isInteger(idade) || idade < 14 || idade > 80) campos.idade = "Idade de 14 a 80.";
  if (!Number.isInteger(idadeAte) || idadeAte < 14 || idadeAte > 80) campos.idadeAte = "Idade de 14 a 80.";
  else if (Number.isInteger(idade) && idadeAte < idade) campos.idadeAte = "Menor que a idade inicial.";
  let aceitaMedio = false;
  if (tipo === 1) {
    if (body.aceitaMedio !== "sim" && body.aceitaMedio !== "nao") campos.aceitaMedio = "Diga se a vaga aceita estudante do ensino médio.";
    aceitaMedio = body.aceitaMedio === "sim";
  }
  const atividades = texto("atividades");
  const requisitos = texto("requisitos");
  if (atividades.length < 3) campos.atividades = "Descreva o que a pessoa vai fazer.";
  if (requisitos.length < 3) campos.requisitos = "Diga o que a pessoa precisa ter ou saber.";
  const primeiro = Object.values(campos)[0];
  if (primeiro) throw new AppError(422, "VALIDACAO", Object.keys(campos).length > 1 ? "Confira os campos marcados." : primeiro, campos);
  return {
    tipo, cargo, quantidade, salario: salario!, cargaHoraria, entrada, saida, sabado, sexo, idade, idadeAte, aceitaMedio,
    atividades, requisitos, beneficios: texto("beneficios") || null,
  };
}

function situacaoVaga(status: unknown) {
  const codigo = Number(status);
  if ([0, 3, 4, 5, 9].includes(codigo)) return "Aberta";
  if (codigo === 8) return "Pausada";
  if (codigo === 1) return "Contratada";
  return "Fechada";
}

function dataValida(valor: string | undefined) {
  return dataIsoValida(valor);
}

function dataSp(dias: number) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return dataSpDe(hoje, dias);
}

function dataSpDe(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/**
 * Dias de um período. O teto é alto (cerca de 11 anos) porque o saldo total soma o contrato inteiro; quem limita o
 * período escolhido na tela é cada relatório.
 */
function intervalo(de: string, ate: string) {
  const dias: string[] = [];
  const inicio = new Date(`${de}T12:00:00Z`).getTime();
  const fim = new Date(`${ate}T12:00:00Z`).getTime();
  for (let cursor = Math.min(inicio, fim); cursor <= Math.max(inicio, fim) && dias.length < 4000; cursor += 86_400_000) {
    dias.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dias;
}

function minutosRelogio(valor: string | null | undefined) {
  if (!valor) return null;
  const [hora, minuto] = valor.trim().replace(/^-/, "").split(":");
  if (hora === undefined || minuto === undefined || hora === "") return null;
  const h = Number(hora);
  const m = Number(minuto);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
}

/** "HH:MM" ou "HH:MM:SS" em segundos (sem segundos, conta 0). */
function segundosRelogio(valor: string | null | undefined) {
  if (!valor) return null;
  const [hora, minuto, segundo = "0"] = valor.trim().replace(/^-/, "").split(":");
  if (hora === undefined || minuto === undefined || hora === "") return null;
  const [h, m, s] = [Number(hora), Number(minuto), Number(segundo)];
  return Number.isInteger(h) && Number.isInteger(m) && Number.isInteger(s) ? h * 3600 + m * 60 + s : null;
}

/** Segundos em minutos arredondando para o mais perto (30s ou mais sobe), com o mesmo sinal. */
function paraMinutos(segundos: number) {
  const minutos = Math.round(Math.abs(segundos) / 60);
  return segundos < 0 ? -minutos : minutos;
}

/** "HH:MM:SS" entre dois horários (passa da meia-noite), no formato de tabela_ponto.horas_trabalhadas. */
function horasEntreRelogio(inicio: string, fim: string) {
  const a = segundosRelogio(inicio);
  const b = segundosRelogio(fim);
  if (a === null || b === null) return null;
  const total = b >= a ? b - a : b - a + 24 * 3600;
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((parte) => String(parte).padStart(2, "0")).join(":");
}

function relogio(minutos: number) {
  const absoluto = Math.abs(Math.round(minutos));
  const hora = Math.floor(absoluto / 60);
  const minuto = absoluto % 60;
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00`;
}

function minutosDaCarga(carga: CargaBase | undefined) {
  const entrada = minutosRelogio(carga?.entrada);
  const saida = minutosRelogio(carga?.saida);
  if (entrada === null || saida === null) return 0;
  let total = saida - entrada;
  if (total < 0) total += 24 * 60;
  if (refeicaoLivre(carga)) return Math.max(0, total - Number(carga!.refeicao_minutos));
  const pausaSaida = minutosRelogio(carga?.saida_refeicao);
  const pausaVolta = minutosRelogio(carga?.retorno_refeicao);
  if (pausaSaida !== null && pausaVolta !== null && pausaVolta !== saida) {
    let pausa = pausaVolta - pausaSaida;
    if (pausa < 0) pausa += 24 * 60;
    total -= pausa;
  }
  return Math.max(0, total);
}

/**
 * O intervalo serve para descanso no meio do expediente (CLT, art. 71). A lei não diz quanto longe das pontas ele precisa
 * ficar, mas a Justiça do Trabalho não aceita almoço colado na entrada ou na saída. Critério nosso, só para a empresa
 * ver: sair para o almoço com menos de 1 hora de trabalho, ou voltar com menos de 1 hora para terminar o dia.
 */
const ALMOCO_LONGE_DAS_PONTAS = 60 * 60;

function alertaDoAlmoco(batidas: Array<{ entrada: string | null; saida: string | null }>) {
  if (batidas.length < 2) return "";
  const entrada = segundosRelogio(batidas[0].entrada);
  const saiAlmoco = segundosRelogio(batidas[0].saida);
  const voltaAlmoco = segundosRelogio(batidas[1].entrada);
  const saida = segundosRelogio(batidas[batidas.length - 1].saida);
  const entre = (a: number, b: number) => (b >= a ? b - a : b - a + 24 * 3600);
  const texto = (segundos: number) => { const m = Math.round(segundos / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  const avisos: string[] = [];
  if (entrada !== null && saiAlmoco !== null && entre(entrada, saiAlmoco) < ALMOCO_LONGE_DAS_PONTAS) {
    avisos.push(`saiu para o almoço ${texto(entre(entrada, saiAlmoco))} depois de entrar`);
  }
  if (voltaAlmoco !== null && saida !== null && entre(voltaAlmoco, saida) < ALMOCO_LONGE_DAS_PONTAS) {
    avisos.push(`voltou do almoço ${texto(entre(voltaAlmoco, saida))} antes de sair`);
  }
  return avisos.length ? `Almoço muito perto ${avisos.length === 2 ? "da entrada e da saída" : avisos[0].startsWith("saiu") ? "da entrada" : "da saída"}: ${avisos.join(" e ")}.` : "";
}

/** Tempo trabalhado no dia em segundos (cada trecho com os segundos, sem cortar). */
function segundosTrabalhados(batidas: Array<{ entrada: string | null; saida: string | null; horas: string | null }>, horasBanco: string | null | undefined) {
  const pelasBatidas = batidas.reduce((soma, batida) => {
    const entrada = segundosRelogio(batida.entrada);
    const saida = segundosRelogio(batida.saida);
    if (entrada !== null && saida !== null) {
      const intervaloBatida = saida - entrada;
      return soma + (intervaloBatida < 0 ? intervaloBatida + 24 * 3600 : intervaloBatida);
    }
    return soma + (segundosRelogio(batida.horas) ?? 0);
  }, 0);
  if (pelasBatidas > 0) return pelasBatidas;
  return segundosRelogio(horasBanco) ?? 0;
}

/**
 * Trabalho noturno (CLT, art. 73): entre 22h e 5h a hora vale 52min30s, ou seja, cada hora de relógio conta 8/7.
 * Súmula 60, II, do TST: quem trabalhou a noite e passou das 5h continua no horário noturno até sair.
 * Recebe trechos [início, fim] em segundos do dia (o fim pode passar de 24h) e devolve os segundos de relógio noturnos.
 */
function segundosNoturnos(trechos: Array<[number, number]>) {
  if (!trechos.length) return 0;
  // Começo do trabalho no dia: a prorrogação depois das 5h só é noturna para quem começou até as 22h (cumpriu a noite).
  const comeco = Math.min(...trechos.map(([inicio]) => inicio));
  let total = 0;
  for (const [inicio, fim] of trechos) {
    // Janelas noturnas que um trecho pode tocar: a da noite anterior (até 5h), a da noite do dia e a da noite seguinte.
    for (const base of [-86_400, 0, 86_400]) {
      const de = base + 22 * 3600;
      const ate = base + 29 * 3600;
      const sobra = Math.min(fim, ate) - Math.max(inicio, de);
      if (sobra > 0) total += sobra;
      // (com a tolerância de 10 minutos do dia, CLT art. 58 §1º)
      if (comeco <= de + 600 && fim > ate) total += fim - Math.max(inicio, ate);
    }
  }
  return total;
}

/** Trechos [início, fim] das batidas do dia, com a saída depois da meia-noite somada de 24h. */
function trechosDasBatidas(batidas: Array<{ entrada: string | null; saida: string | null }>) {
  const trechos: Array<[number, number]> = [];
  let base = 0;
  let anterior = -1;
  for (const batida of batidas) {
    const entrada = segundosRelogio(batida.entrada);
    const saida = segundosRelogio(batida.saida);
    if (entrada === null || saida === null) continue;
    // Batidas já em ordem: uma entrada "menor" que a saída anterior é depois da meia-noite.
    if (entrada + base < anterior) base += 86_400;
    const inicio = entrada + base;
    const fim = saida + base >= inicio ? saida + base : saida + base + 86_400;
    trechos.push([inicio, fim]);
    anterior = fim;
  }
  return trechos;
}

/** Trechos de trabalho previstos na carga do dia (sem a refeição fixa). */
function trechosDaCarga(carga: CargaBase | undefined) {
  if (!carga) return [];
  const horario = horarioDaCarga(carga);
  const pares: Array<[string, string]> = horario.pausa && !horario.refeicaoLivre
    ? [[horario.entrada, horario.saidaRefeicao], [horario.retornoRefeicao, horario.saida]]
    : [[horario.entrada, horario.saida]];
  let base = 0;
  let anterior = -1;
  const trechos: Array<[number, number]> = [];
  for (const [de, ate] of pares) {
    const inicio = segundosRelogio(de);
    const fim = segundosRelogio(ate);
    if (inicio === null || fim === null) continue;
    // Depois da meia-noite o horário "volta" para o começo do dia: soma 24h para manter a ordem.
    if (inicio + base < anterior) base += 86_400;
    const a = inicio + base;
    const b = fim + base >= a ? fim + base : fim + base + 86_400;
    trechos.push([a, b]);
    anterior = b;
  }
  return trechos;
}

/**
 * Ordem das batidas no turno da noite: quem entra às 22h e volta do intervalo às 2h tem a batida das 2h depois da das
 * 22h, mesmo ela sendo "menor". Na jornada noturna, horários antes do meio-dia vão para o fim.
 */
function ordenarBatidas<T extends { entrada: string | null }>(batidas: T[], carga: CargaBase | undefined) {
  const noturna = Boolean(carga?.entrada && carga?.saida && carga.entrada.slice(0, 5) > carga.saida.slice(0, 5));
  if (!noturna) return batidas;
  const chave = (batida: T) => { const s = segundosRelogio(batida.entrada) ?? 0; return s < 12 * 3600 ? s + 86_400 : s; };
  return [...batidas].sort((a, b) => chave(a) - chave(b));
}

function dinheiro(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor).trim();
  if (!texto || texto === "0" || texto === "0.00") return texto;
  return texto.startsWith("R$") ? texto : `R$ ${texto}`;
}

function ficha(titulo: unknown, subtitulo: unknown, campos: Array<[string, unknown]>) {
  return {
    titulo: titulo ? String(titulo) : "Registro",
    subtitulo: subtitulo ? String(subtitulo) : "",
    campos: campos.map(([rotulo, valor]) => ({
      rotulo,
      valor: valor === null || valor === undefined || String(valor).trim() === "" ? "—" : String(valor),
    })),
  };
}

function saldoGravado(valor: string) {
  const negativo = valor.trim().startsWith("-");
  const texto = valor.trim().replace(/^-/, "");
  return { texto: texto.length === 5 ? `${texto}:00` : texto, negativo };
}

export class PortalDadosService {
  constructor(
    private readonly db: Pool,
    /** Interno (INTERNO_API_URL + SERVICE_TOKEN): a vaga abre pelo mesmo fluxo da "Nova vaga" de lá. */
    private readonly interno: { url: string; token: string } = { url: "", token: "" },
    private readonly avisar: (mensagem: string, dados?: Record<string, unknown>) => void = () => undefined,
  ) {}

  async painel(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const contagem = await this.db.query<{ ativos: string; vagas: string; contratos: string; batidas: string }>(`
      select
        (select count(distinct pessoa)::text from (
          select cv.id_candidato as pessoa
          from dna_work.conratacaovaga cv
          left join dna_work.vaga v on v.id_vaga = cv.id_vaga
          where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
            and cv.status = 1
            and nullif(btrim(cv.data_demicao), '') is null
          union
          select col.id_candidato
          from dna_work.colaborador col
          where col.id_empresa = $1
            and coalesce(col.status_colaborador, 1) = 1
        ) pessoas) as ativos,
        (select count(*) from dna_work.vaga
          where id_empresa = $1 and status in (0, 3, 4, 5, 9))::text as vagas,
        (select count(*) from dna_work.conratacaovaga where id_empresa = $1)::text as contratos,
        (select count(*)::text
          from dna_work.tabela_ponto t
          join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
          where col.id_empresa = $1
            and coalesce(t.excluido, 0) = 0
            and replace(t.data, '-', '/') like to_char((current_timestamp at time zone 'America/Sao_Paulo'), 'YYYY/MM') || '/%'
        ) as batidas
    `, [empresaId]);
    const empresa = await this.db.query<{ nome: string | null; cnpj: string | null; ponto: number | null }>(`
      select coalesce(nome_fantasia, razao_social) as nome, cnpj, ponto
      from dna_work.empresa where id_empresa = $1
    `, [empresaId]);
    return {
      empresa: empresa.rows[0]?.nome ?? "",
      cnpj: empresa.rows[0]?.cnpj ?? "",
      colaboradoresAtivos: Number(contagem.rows[0]?.ativos ?? 0),
      vagasAbertas: Number(contagem.rows[0]?.vagas ?? 0),
      contratos: Number(contagem.rows[0]?.contratos ?? 0),
      batidasMes: Number(contagem.rows[0]?.batidas ?? 0),
      pontoAtivo: Number(empresa.rows[0]?.ponto) === 1,
    };
  }

  async colaboradores(usuarioId: string, empresaId: string, busca: string, status = "todos") {
    await this.garantir(usuarioId, empresaId);
    const situacao = status === "ativo" || status === "inativo" ? status : "todos";
    const rows = await this.db.query(`
      select nome, email, celular, cargo, departamento, modalidade, contrato, datainicio, situacao, id_candidato
      from (
        select c.nome, c.email, c.celular, v.cargo, col.departamento, m.descricao as modalidade, m.descricao as contrato, cv.datainicio,
               case
                 when col.status_colaborador = 1 then 'Ativo'
                 when cv.status = 2 or nullif(btrim(cv.data_demicao), '') is not null then 'Encerrado'
                 else 'Ativo'
               end as situacao,
               c.id_candidato
        from dna_work.conratacaovaga cv
        join dna_work.candidato c on c.id_candidato = cv.id_candidato
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
        left join lateral (
          select departamento, status_colaborador
          from dna_work.colaborador
          where id_candidato = c.id_candidato
            and id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
          order by case when status_colaborador = 1 then 0 else 1 end, data_cadastro desc nulls last
          limit 1
        ) col on true
        where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
          and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
        union all
        select c.nome, c.email, c.celular, col.cargo, col.departamento, m.descricao, m.descricao, col.data_inicio,
               case when col.status_colaborador = 1 then 'Ativo' else 'Inativo' end,
               c.id_candidato
        from dna_work.colaborador col
        join dna_work.candidato c on c.id_candidato = col.id_candidato
        left join dna_work.modalidade_vaga m on m.id::text = col.tipo_vaga::text
        where col.id_empresa = $1
          and not exists (
            select 1
            from dna_work.conratacaovaga cv
            left join dna_work.vaga v on v.id_vaga = cv.id_vaga
            where cv.id_candidato = col.id_candidato
              and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = col.id_empresa
          )
          and ($2 = '' or c.nome ilike $3 or coalesce(col.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
      ) pessoas
      where (
        $4 = 'todos'
        or ($4 = 'ativo' and situacao = 'Ativo')
        or ($4 = 'inativo' and situacao <> 'Ativo')
      )
      order by nome
    `, [empresaId, busca, `%${busca}%`, situacao]);
    return rows.rows;
  }

  /**
   * Colaboradores do ponto (cada linha de dna_work.colaborador da empresa). Situação: Férias ou Recesso, para estagiário
   * (hoje dentro de um período de dna_work.ferias), Fora do ponto (status_ponto 0), Desligado ou Ativo. Jornada = escala + carga horária ligadas.
   * Modalidade: a do colaborador (tipo_vaga) ou a da vaga da última contratação.
   */
  async colaboradoresPonto(usuarioId: string, empresaId: string, busca: string, status: string, permitidos: Set<string> | null = null) {
    await this.garantir(usuarioId, empresaId);
    const filtro = status === "ativo" || status === "inativo" ? status : "todos";
    const hoje = dataLegado(dataSp(0));
    const rows = await this.db.query(`
      select * from (
        -- Uma linha por pessoa: a passagem ativa ou, se todas foram desligadas, a mais recente.
        select distinct on (col.id_candidato)
               c.nome, c.id_candidato, col.id_colaborador, col.departamento, c.cpf,
               coalesce(nullif(btrim(col.cargo), ''), ultima.cargo) as cargo,
               m.descricao as modalidade,
               coalesce(nullif(btrim(col.data_inicio), ''), ultima.datainicio) as datainicio,
               case
                 when coalesce(col.status_colaborador, 1) <> 1 then 'Desligado'
                 when coalesce(col.status_ponto, 0) <> 1 then 'Fora do ponto'
                 when exists (
                   select 1 from dna_work.ferias f
                   where f.id_colaborador = col.id_colaborador and replace(f.inicio, '-', '/') <= $4 and replace(f.fim, '-', '/') >= $4
                 ) then case when coalesce(col.tipo_vaga, ultima.tipo_vaga)::text = '1' then 'Recesso' else 'Férias' end
                 else 'Ativo'
               end as situacao,
               nullif(btrim(esc.nome), '') as jornada
        from dna_work.colaborador col
        join dna_work.candidato c on c.id_candidato = col.id_candidato
        left join lateral (
          select v.cargo, v.tipo_vaga, cv.datainicio
          from dna_work.conratacaovaga cv
          left join dna_work.vaga v on v.id_vaga = cv.id_vaga
          where cv.id_candidato = col.id_candidato
            and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = col.id_empresa
          order by cv.data_contratacao desc nulls last
          limit 1
        ) ultima on true
        left join dna_work.modalidade_vaga m on m.id::text = coalesce(col.tipo_vaga, ultima.tipo_vaga)::text
        left join lateral (select escala from dna_work.carga_horaria ch where ch.id_colaborador = col.id_colaborador limit 1) ch on true
        left join dna_work.ponto_turno_base esc on esc.id = ch.escala and esc.id_empresa = col.id_empresa
        where col.id_empresa = $1
          and ($2 = '' or c.nome ilike $3 or coalesce(col.cargo, '') ilike $3 or coalesce(col.departamento, '') ilike $3)
        order by col.id_candidato, case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last, col.data_inicio desc nulls last
      ) pessoas
      where $5 = 'todos'
         or ($5 = 'ativo' and situacao in ('Ativo', 'Férias', 'Recesso'))
         or ($5 = 'inativo' and situacao not in ('Ativo', 'Férias', 'Recesso'))
      order by nome
    `, [empresaId, busca, `%${busca}%`, hoje, filtro]);
    return permitidos ? rows.rows.filter((linha) => permitidos.has(String(linha.id_candidato))) : rows.rows;
  }

  /** Colaborador do ponto pelo id_candidato da tela (o ativo primeiro, depois o mais recente). */
  private async colaboradorDaEmpresa(empresaId: string, idCandidato: string) {
    const rows = await this.db.query<{ id_colaborador: string; status_ponto: number | null; carga_base: string | null }>(`
      select id_colaborador, status_ponto, carga_base::text as carga_base
      from dna_work.colaborador
      where id_candidato = $1 and id_empresa = $2
      order by case when status_colaborador = 1 then 0 else 1 end, data_cadastro desc nulls last
      limit 1
    `, [idCandidato, empresaId]);
    const colaborador = rows.rows[0];
    if (!colaborador) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado nesta empresa.");
    return colaborador;
  }

  /** Configuração do ponto da pessoa: se está no ponto, a jornada (escala com o horário de cada dia) e as férias. */
  async configuracaoPonto(usuarioId: string, empresaId: string, idCandidato: string) {
    await this.garantir(usuarioId, empresaId);
    const colaborador = await this.colaboradorDaEmpresa(empresaId, idCandidato);
    const [jornada, ferias] = await Promise.all([
      this.db.query<{ escala: number | null }>("select escala from dna_work.carga_horaria where id_colaborador = $1 limit 1", [colaborador.id_colaborador]),
      this.db.query<{ id: number; inicio: string; fim: string }>(
        "select id, replace(inicio, '/', '-') as inicio, replace(fim, '/', '-') as fim from dna_work.ferias where id_colaborador = $1 order by inicio desc",
        [colaborador.id_colaborador],
      ),
    ]);
    const escala = jornada.rows[0]?.escala;
    return {
      noPonto: Number(colaborador.status_ponto) === 1,
      jornada: escala ? String(escala) : "",
      ferias: ferias.rows,
    };
  }

  /** Troca a jornada de trabalho da pessoa (dias e horário de cada dia). */
  async salvarJornada(usuarioId: string, empresaId: string, idCandidato: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const colaborador = await this.colaboradorDaEmpresa(empresaId, idCandidato);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.aplicarJornada(client, colaborador.id_colaborador, empresaId, body.jornada ?? "");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  /**
   * "Apagar" na tela = desligar. NÃO apaga nada: a Portaria MTP 671/2021 obriga a empresa a guardar e apresentar os
   * registros de ponto (e a CLT permite cobrar até 5 anos para trás), então batidas, AFD, banco de horas, férias e
   * atestados ficam. A pessoa sai da lista principal, não bate mais ponto e aparece no filtro "Desligados".
   * Reativar não volta esta linha: o cadastro cria uma passagem nova (salvarColaborador com reativar), que começa do zero.
   */
  async desligarColaborador(usuarioId: string, empresaId: string, idCandidato: string, ultimoDia?: string) {
    await this.garantir(usuarioId, empresaId);
    const atual = await this.colaboradorDaEmpresa(empresaId, idCandidato);
    // Último dia de trabalho (padrão: hoje). Depois dele o relatório não conta falta.
    const hoje = dataSp(0);
    const dia = ultimoDia ? dataValida(ultimoDia) : hoje;
    if (!dia) throw new AppError(422, "VALIDACAO", "Informe o último dia de trabalho.", { ultimoDia: "Informe o último dia de trabalho." });
    if (dia > hoje) throw new AppError(422, "VALIDACAO", "O último dia de trabalho não pode ser no futuro.", { ultimoDia: "Use hoje ou uma data passada." });
    const inicio = (await this.db.query<{ inicio: string | null }>("select replace(data_inicio, '/', '-') as inicio from dna_work.colaborador where id_colaborador = $1", [atual.id_colaborador])).rows[0]?.inicio;
    if (inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && dia < inicio) {
      throw new AppError(422, "VALIDACAO", "O último dia não pode ser antes do início do contrato.", { ultimoDia: "Antes do início do contrato." });
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      // Só a passagem ativa ganha a data; contratos já encerrados ficam com a deles.
      await client.query(
        `update dna_work.colaborador set status_colaborador = 0, status_ponto = 0,
           data_desligamento = case when coalesce(status_colaborador, 1) = 1 then $3 else data_desligamento end
         where id_candidato = $1 and id_empresa = $2`,
        [idCandidato, empresaId, dataLegado(dia)],
      );
      // Sem outra empresa em que a pessoa siga ativa, ela deixa de aparecer como colaboradora.
      await client.query(`
        update dna_work.candidato set colaborador = 0
        where id_candidato = $1
          and not exists (select 1 from dna_work.colaborador c where c.id_candidato = $1 and c.status_colaborador = 1)
      `, [idCandidato]);
      // Desligado perde na hora as permissões do ponto da equipe (se voltar, a empresa dá de novo).
      await client.query("delete from dna_work.ponto_permissao_gestor_pessoa where id_gestor = $1 and id_empresa = $2", [idCandidato, empresaId]);
      await client.query("delete from dna_work.ponto_permissao_gestor where id_gestor = $1 and id_empresa = $2", [idCandidato, empresaId]);
      await client.query("COMMIT");
      return { ativo: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Férias: período em dna_work.ferias. O ponto já bloqueia a batida nesses dias; o relatório mostra "Férias". */
  async salvarFerias(usuarioId: string, empresaId: string, idCandidato: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const colaborador = await this.colaboradorDaEmpresa(empresaId, idCandidato);
    const campos: Record<string, string> = {};
    if (!dataValida(body.inicio)) campos.inicio = "Informe o primeiro dia de férias.";
    if (!dataValida(body.fim)) campos.fim = "Informe o último dia de férias.";
    else if (dataValida(body.inicio) && body.fim < body.inicio) campos.fim = "O último dia vem depois do primeiro.";
    const primeiro = Object.values(campos)[0];
    if (primeiro) throw new AppError(422, "VALIDACAO", Object.keys(campos).length > 1 ? "Informe o período das férias." : primeiro, campos);
    const inicio = dataLegado(body.inicio);
    const fim = dataLegado(body.fim);
    // Contrato atual: ativo, início, modalidade (estágio = recesso) e os dias de descanso da jornada.
    const contrato = (await this.db.query<{ ativo: boolean; data_inicio: string | null; modalidade: string | null; domingo: string | null; folgas: string[] | null }>(`
      select coalesce(col.status_colaborador, 1) = 1 as ativo, replace(col.data_inicio, '/', '-') as data_inicio,
             coalesce(col.tipo_vaga::text, (
               select v.tipo_vaga::text from dna_work.conratacaovaga cv join dna_work.vaga v on v.id_vaga = cv.id_vaga
               where cv.id_candidato = col.id_candidato order by cv.data_contratacao desc nulls last limit 1
             )) as modalidade,
             ch.domingo,
             array_remove(array[
               case when ch.segunda is distinct from '1' then 1 end, case when ch.terca is distinct from '1' then 2 end,
               case when ch.quarta is distinct from '1' then 3 end, case when ch.quinta is distinct from '1' then 4 end,
               case when ch.sexta is distinct from '1' then 5 end, case when ch.sabado is distinct from '1' then 6 end
             ]::text[], null) as folgas
      from dna_work.colaborador col
      left join lateral (select * from dna_work.carga_horaria c where c.id_colaborador = col.id_colaborador limit 1) ch on true
      where col.id_colaborador = $1
    `, [colaborador.id_colaborador])).rows[0];
    if (!contrato?.ativo) throw new AppError(409, "COLABORADOR_DESLIGADO", "Este colaborador está desligado: não dá para lançar férias.");
    const estagio = contrato.modalidade === "1";
    // Descanso semanal: o domingo; quem trabalha no domingo descansa nos dias de folga da jornada.
    const trabalhaDomingo = contrato.domingo === "1";
    const diasDeDescanso = new Set(trabalhaDomingo ? (contrato.folgas ?? []).map(Number) : [0]);
    const vizinhos = [1, 2].map((n) => somarDias(body.inicio, n));
    const feriadosPerto = await this.diasDeFeriado(empresaId, vizinhos.map((dia) => dia.replaceAll("-", "/")));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(hashtext('dna_work.ferias'))");
      const sobreposta = await client.query(`
        select 1 from dna_work.ferias
        where id_colaborador = $1 and replace(inicio, '-', '/') <= $3 and replace(fim, '-', '/') >= $2
        limit 1
      `, [colaborador.id_colaborador, inicio, fim]);
      if (sobreposta.rowCount) throw new AppError(409, "FERIAS_SOBREPOSTAS", "Já existe férias neste período.");
      const existentes = (await client.query<{ inicio: string; fim: string }>(
        "select replace(inicio, '/', '-') as inicio, replace(fim, '/', '-') as fim from dna_work.ferias where id_colaborador = $1",
        [colaborador.id_colaborador],
      )).rows.filter((linha) => dataValida(linha.inicio) && dataValida(linha.fim));
      const problema = problemaNasFerias({ inicio: body.inicio, fim: body.fim }, {
        estagio,
        inicioContrato: dataValida(contrato.data_inicio ?? "") ?? "",
        existentes,
        descansoOuFeriado: (iso) => feriadosPerto.has(iso.replaceAll("-", "/")) || diasDeDescanso.has(new Date(`${iso}T12:00:00Z`).getUTCDay()),
      });
      if (problema) throw new AppError(422, "FERIAS_FORA_DA_LEI", problema, { inicio: problema });
      const id = await proximoId(client, "ferias");
      await client.query(
        "insert into dna_work.ferias (id, id_candidato, id_colaborador, inicio, fim) values ($1,$2,$3,$4,$5)",
        [id, idCandidato, colaborador.id_colaborador, inicio, fim],
      );
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async excluirFerias(usuarioId: string, empresaId: string, idCandidato: string, idFerias: string) {
    await this.garantir(usuarioId, empresaId);
    const colaborador = await this.colaboradorDaEmpresa(empresaId, idCandidato);
    const apagada = await this.db.query("delete from dna_work.ferias where id::text = $1 and id_colaborador = $2", [idFerias, colaborador.id_colaborador]);
    if (!apagada.rowCount) throw new AppError(404, "FERIAS_NAO_ENCONTRADAS", "Férias não encontradas.");
    return { id: idFerias };
  }

  async vagas(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    // A "Nova vaga" grava uma linha por posição com o mesmo comparador: aqui elas viram uma vaga só, por situação.
    const rows = await this.db.query(`
      select (array_agg(v.id_vaga order by v.id_vaga))[1] as id,
             max(coalesce(nullif(btrim(v.codigo::text), ''), v.comparador)) as codigo,
             max(v.cargo) as cargo, sum(coalesce(v.quantidade_posicoes, 1))::int as vagas, v.status,
             max(v.dataabertura) as dataabertura, max(v.salario) as salario,
             max(coalesce(nullif(btrim(v.cidade), ''), e.cidade)) as cidade, max(v.periodo) as periodo,
             max(m.descricao) as contrato,
             bool_or(v.tipo_vaga = 1 and v.escolaridade::text = '31') as aceita_medio
      from dna_work.vaga v
      join dna_work.empresa e on e.id_empresa = v.id_empresa
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where v.id_empresa = $1
        and ($2 = '' or v.cargo ilike $3)
      group by coalesce(nullif(btrim(v.comparador), ''), v.id_vaga), v.status
      order by max(v.dataabertura) desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      ...row,
      situacao: situacaoVaga(row.status),
    }));
  }

  async contratados(usuarioId: string, empresaId: string, busca: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select cv.id_contratacao as id, c.nome, v.cargo, m.descricao as contrato, cv.datainicio, cv.data_demicao, cv.status,
             (select col.departamento from dna_work.colaborador col
               where col.id_candidato = c.id_candidato and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
               limit 1) as departamento
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $1
        and ($2 = '' or c.nome ilike $3 or coalesce(v.cargo, '') ilike $3)
      order by cv.data_contratacao desc nulls last
      limit 200
    `, [empresaId, busca, `%${busca}%`]);
    return rows.rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      cargo: row.cargo,
      departamento: row.departamento,
      contrato: row.contrato,
      inicio: row.datainicio,
      situacao: row.data_demicao || Number(row.status) === 2 ? "Encerrado" : "Ativo",
    }));
  }

  /**
   * Jornadas da empresa. Jornada = dna_work.ponto_turno_base (dias de trabalho, 1/0) com o horário de cada dia na própria
   * linha (segunda_carga… domingo_carga → ponto_carga_base). Escalas antigas sem horário aparecem como incompletas.
   */
  async jornadas(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    return this.lerJornadas(empresaId);
  }

  async jornada(usuarioId: string, empresaId: string, id: string) {
    await this.garantir(usuarioId, empresaId);
    const jornada = (await this.lerJornadas(empresaId, id))[0];
    if (!jornada) throw new AppError(404, "JORNADA_NAO_ENCONTRADA", "Jornada não encontrada.");
    return jornada;
  }

  private async lerJornadas(empresaId: string, id?: string) {
    const [turnos, cargas] = await Promise.all([
      this.db.query<Record<string, string | number | null>>(`
        select t.*,
               (select count(distinct col.id_colaborador)::int from dna_work.carga_horaria ch
                  join dna_work.colaborador col on col.id_colaborador = ch.id_colaborador
                 where ch.escala = t.id and col.id_empresa = t.id_empresa and coalesce(col.status_colaborador, 1) = 1) as colaboradores
        from dna_work.ponto_turno_base t
        where t.id_empresa = $1 and ($2 = '' or t.id::text = $2)
        order by t.nome
      `, [empresaId, id ?? ""]),
      this.db.query<CargaBase>(
        `select ${COLUNAS_CARGA} from dna_work.ponto_carga_base where id_empresa = $1`,
        [empresaId],
      ),
    ]);
    const porId = new Map(cargas.rows.map((carga) => [String(carga.id), carga]));
    return turnos.rows.map((turno) => {
      const dias = DIAS_SEMANA.map(({ chave, coluna, rotulo }) => {
        const trabalha = Number(turno[coluna]) === 1;
        const carga = trabalha && turno[`${chave}_carga`] != null ? porId.get(String(turno[`${chave}_carga`])) : undefined;
        return {
          dia: chave,
          rotulo,
          trabalha,
          horario: carga ? horarioDaCarga(carga) : null,
        };
      });
      return {
        id: Number(turno.id),
        nome: String(turno.nome ?? ""),
        // 1 estágio, 2 CLT; vazio nas escalas antigas.
        modalidade: turno.modalidade == null ? "" : String(turno.modalidade),
        dias,
        // Escala antiga, sem o horário de algum dia de trabalho: precisa ser completada antes de ligar a alguém.
        completa: dias.every((dia) => !dia.trabalha || dia.horario),
        resumo: resumoDaJornada(dias),
        colaboradores: Number(turno.colaboradores ?? 0),
      };
    });
  }

  /**
   * Cadastra ou altera a jornada. Cada dia de trabalho ganha uma carga (ponto_carga_base): reaproveita a da empresa com o
   * mesmo horário ou cria uma. Ao alterar, quem já usa a jornada passa a seguir o horário novo (as batidas antigas
   * guardam a carga da época em tabela_ponto.id_carga).
   */
  async salvarJornadaEmpresa(usuarioId: string, empresaId: string, body: Record<string, string>, id?: string) {
    await this.garantir(usuarioId, empresaId);
    const nome = (body.nome ?? "").trim().slice(0, 255);
    // A tolerância é a da lei, igual para todos (ver dentroDaTolerancia); a carga guarda os 5 min por batida.
    const tolerancia = String(TOLERANCIA_POR_BATIDA);
    const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
    const campos: Record<string, string> = {};
    const modalidade = body.modalidade === "1" || body.modalidade === "2" ? body.modalidade : null;
    if (nome.length < 2) campos.nome = "Informe o nome da jornada.";
    if (!modalidade) campos.modalidade = "Escolha se a jornada é de estágio ou CLT.";
    const dias = DIAS_SEMANA.map(({ chave, rotulo }) => {
      const trabalha = body[chave] === "1";
      const pausa = body[`${chave}_pausa`] === "1";
      const entrada = body[`${chave}_entrada`] ?? "";
      const saida = body[`${chave}_saida`] ?? "";
      const saidaRefeicao = body[`${chave}_saida_refeicao`] ?? "";
      const retornoRefeicao = body[`${chave}_retorno_refeicao`] ?? "";
      // Almoço livre: só o tempo de refeição é obrigatório (HH:MM); a hora de sair fica com a pessoa.
      const refeicaoLivre = pausa && body[`${chave}_refeicao_livre`] === "1";
      const duracaoRefeicao = body[`${chave}_duracao_refeicao`] ?? "";
      const minutosRefeicao = /^\d{2}:[0-5]\d$/.test(duracaoRefeicao) ? Number(duracaoRefeicao.slice(0, 2)) * 60 + Number(duracaoRefeicao.slice(3, 5)) : 0;
      if (trabalha) {
        if (!hora.test(entrada)) campos[`${chave}_entrada`] = `Informe a entrada de ${rotulo.toLowerCase()}.`;
        if (!hora.test(saida)) campos[`${chave}_saida`] = `Informe a saída de ${rotulo.toLowerCase()}.`;
        else if (saida === entrada) campos[`${chave}_saida`] = "A saída precisa ser diferente da entrada.";
        if (refeicaoLivre) {
          if (minutosRefeicao < 15) campos[`${chave}_duracao_refeicao`] = "Informe o tempo de refeição (pelo menos 15 minutos).";
        } else {
          if (pausa && !hora.test(saidaRefeicao)) campos[`${chave}_saida_refeicao`] = "Informe a saída para a refeição.";
          if (pausa && !hora.test(retornoRefeicao)) campos[`${chave}_retorno_refeicao`] = "Informe o retorno da refeição.";
        }
      }
      return { chave, rotulo, trabalha, pausa, refeicaoLivre, minutosRefeicao, entrada, saida, saidaRefeicao, retornoRefeicao };
    });
    if (!dias.some((dia) => dia.trabalha)) campos.dias = "Marque pelo menos um dia de trabalho.";
    const primeiro = Object.values(campos)[0];
    if (primeiro) throw new AppError(422, "VALIDACAO", Object.keys(campos).length > 1 ? "Confira os campos marcados." : primeiro, campos);
    // O que a lei não permite não é salvo; o que depende de acordo ou convenção a tela só avisa.
    const { erros } = regrasDaJornada(modalidade!, dias);
    if (erros.length) throw new AppError(422, "JORNADA_FORA_DA_LEI", erros[0], { lei: erros.join("\n") });

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(hashtext('dna_work.ponto_jornada'))");
      if (id) {
        const existe = await client.query("select 1 from dna_work.ponto_turno_base where id::text = $1 and id_empresa = $2", [id, empresaId]);
        if (!existe.rowCount) throw new AppError(404, "JORNADA_NAO_ENCONTRADA", "Jornada não encontrada.");
      }
      const cargaDoDia: Record<string, number | null> = {};
      for (const dia of dias) {
        if (!dia.trabalha) { cargaDoDia[dia.chave] = null; continue; }
        // Sem pausa ou com almoço livre, o sistema antigo grava a refeição igual à saída (não há hora certa).
        const fixa = dia.pausa && !dia.refeicaoLivre;
        const saidaRefeicao = fixa ? dia.saidaRefeicao : dia.saida;
        const retornoRefeicao = fixa ? dia.retornoRefeicao : dia.saida;
        const minutosLivre = dia.refeicaoLivre ? dia.minutosRefeicao : null;
        const igual = await client.query<{ id: number }>(`
          select id from dna_work.ponto_carga_base
          where id_empresa = $1 and entrada = $2 and saida = $3 and coalesce(saida_refeicao, '') = $4
            and coalesce(retorno_refeicao, '') = $5 and coalesce(nullif(tolerancia, ''), '0') = $6 and coalesce(pausa, 0) = $7
            and refeicao_livre = $8 and refeicao_minutos is not distinct from $9::integer
          order by id limit 1
        `, [empresaId, dia.entrada, dia.saida, saidaRefeicao, retornoRefeicao, tolerancia, dia.pausa ? 1 : 0, dia.refeicaoLivre ? 1 : 0, minutosLivre]);
        let idCarga = igual.rows[0]?.id;
        if (!idCarga) {
          idCarga = await proximoId(client, "ponto_carga_base");
          await client.query(`
            insert into dna_work.ponto_carga_base
              (id, id_empresa, nome, tipo, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa, refeicao_livre, refeicao_minutos)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `, [
            idCarga, empresaId, `${dia.entrada} às ${dia.saida}`, tipoDaJornada(dia.entrada, dia.saida),
            dia.entrada, saidaRefeicao, retornoRefeicao, dia.saida, tolerancia, dia.pausa ? 1 : 0, dia.refeicaoLivre ? 1 : 0, minutosLivre,
          ]);
        }
        cargaDoDia[dia.chave] = idCarga;
      }
      const flags = dias.map((dia) => (dia.trabalha ? 1 : 0));
      const cargasDias = DIAS_SEMANA.map(({ chave }) => cargaDoDia[chave]);
      let idJornada: number;
      if (id) {
        idJornada = Number(id);
        await client.query(`
          update dna_work.ponto_turno_base set nome = $3,
            segunda_feira = $4, terca_feira = $5, quarta_feira = $6, quinta_feira = $7, sexta_feira = $8, sabado = $9, domingo = $10,
            segunda_carga = $11, terca_carga = $12, quarta_carga = $13, quinta_carga = $14, sexta_carga = $15, sabado_carga = $16, domingo_carga = $17,
            modalidade = $18
          where id = $1 and id_empresa = $2
        `, [idJornada, empresaId, nome, ...flags, ...cargasDias, Number(modalidade)]);
        // Quem já usa a jornada passa a seguir o horário novo.
        const usam = await client.query<{ id_colaborador: string }>(`
          select ch.id_colaborador from dna_work.carga_horaria ch
          join dna_work.colaborador col on col.id_colaborador = ch.id_colaborador
          where ch.escala = $1 and col.id_empresa = $2
        `, [idJornada, empresaId]);
        for (const linha of usam.rows) await this.aplicarJornada(client, linha.id_colaborador, empresaId, String(idJornada));
      } else {
        idJornada = await proximoId(client, "ponto_turno_base");
        await client.query(`
          insert into dna_work.ponto_turno_base
            (id, nome, id_empresa, segunda_feira, terca_feira, quarta_feira, quinta_feira, sexta_feira, sabado, domingo,
             segunda_carga, terca_carga, quarta_carga, quinta_carga, sexta_carga, sabado_carga, domingo_carga, modalidade)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        `, [idJornada, nome, empresaId, ...flags, ...cargasDias, Number(modalidade)]);
      }
      await this.limparCargasSoltas(client, empresaId);
      await client.query("COMMIT");
      return { id: idJornada };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Apaga a jornada. Em uso por colaborador ou dia marcado não sai: o ponto deixaria de saber os dias e o horário dele. */
  async excluirJornada(usuarioId: string, empresaId: string, id: string) {
    await this.garantir(usuarioId, empresaId);
    const uso = await this.db.query<{ colaboradores: number; dias: number }>(`
      select
        (select count(*)::int from dna_work.carga_horaria ch
           join dna_work.colaborador col on col.id_colaborador = ch.id_colaborador
          where ch.escala::text = $1 and col.id_empresa = $2) as colaboradores,
        (select count(*)::int from dna_work.ponto_data_trabalho d
           join dna_work.colaborador col on col.id_colaborador = d.id_colaborador
          where d.id_escala::text = $1 and col.id_empresa = $2) as dias
    `, [id, empresaId]);
    const { colaboradores, dias } = uso.rows[0];
    if (colaboradores || dias) {
      throw new AppError(409, "JORNADA_EM_USO", colaboradores
        ? `Esta jornada está em uso por ${colaboradores} ${colaboradores === 1 ? "colaborador" : "colaboradores"}. Troque a jornada deles antes de apagar.`
        : "Esta jornada está marcada em dias de trabalho de colaboradores e não pode ser apagada.");
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const apagada = await client.query("delete from dna_work.ponto_turno_base where id::text = $1 and id_empresa = $2", [id, empresaId]);
      if (!apagada.rowCount) throw new AppError(404, "JORNADA_NAO_ENCONTRADA", "Jornada não encontrada.");
      await this.limparCargasSoltas(client, empresaId);
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Horários (ponto_carga_base) criados pelas jornadas do portal que ficaram sem uso: nenhuma jornada, colaborador, dia
   * marcado ou batida aponta para eles. Só apaga os do formato do portal ("08:00 às 17:00"); os do sistema antigo ficam.
   */
  private async limparCargasSoltas(client: { query: Pool["query"] }, empresaId: string) {
    await client.query(`
      delete from dna_work.ponto_carga_base c
      where c.id_empresa = $1
        and c.nome ~ '^[0-2][0-9]:[0-5][0-9] às [0-2][0-9]:[0-5][0-9]$'
        and not exists (
          select 1 from dna_work.ponto_turno_base t
          where t.id_empresa = $1 and c.id in (t.segunda_carga, t.terca_carga, t.quarta_carga, t.quinta_carga, t.sexta_carga, t.sabado_carga, t.domingo_carga)
        )
        and not exists (
          select 1 from dna_work.colaborador col
          left join dna_work.carga_horaria ch on ch.id_colaborador = col.id_colaborador
          where col.id_empresa = $1
            and (col.carga_base::text = c.id::text
              or c.id::text in (ch.segunda_carga, ch.terca_carga, ch.quarta_carga, ch.quinta_carga, ch.sexta_carga, ch.sabado_carga, ch.domingo_carga))
        )
        and not exists (select 1 from dna_work.ponto_data_trabalho d where d.id_carga_horaria::text = c.id::text)
        and not exists (select 1 from dna_work.tabela_ponto tp where tp.id_carga = c.id::text)
    `, [empresaId]);
  }

  /**
   * Liga a jornada à pessoa no formato que o ponto e o relatório leem: dna_work.carga_horaria (tipo 1, escala = jornada,
   * cada dia "1" com a carga do dia ou "folga") e colaborador.carga_base (a carga do primeiro dia de trabalho).
   */
  /** Foto da jornada atual da pessoa (dias e horários copiados), ou null se ela ainda não tem jornada. */
  private async fotoDaJornada(client: { query: Pool["query"] }, idColaborador: string): Promise<FotoJornada | null> {
    const semana = (await client.query<Record<string, string | null>>(`
      select ${CAMPOS_DA_SEMANA.map((campo) => `${campo}, ${campo}_carga::text`).join(", ")}
      from dna_work.carga_horaria where id_colaborador = $1 limit 1
    `, [idColaborador])).rows[0];
    if (!semana) return null;
    const ids = CAMPOS_DA_SEMANA.map((campo) => semana[`${campo}_carga`]).filter((id): id is string => Boolean(id));
    const cargas = ids.length
      ? (await client.query<CargaBase>(`select ${COLUNAS_CARGA} from dna_work.ponto_carga_base where id::text = any($1)`, [ids])).rows
      : [];
    return Object.fromEntries(CAMPOS_DA_SEMANA.map((campo) => [campo, {
      trabalha: semana[campo] === "1",
      carga: cargas.find((carga) => String(carga.id) === semana[`${campo}_carga`]) ?? null,
    }]));
  }

  private async aplicarJornada(client: { query: Pool["query"] }, idColaborador: string, empresaId: string, idJornada: string) {
    // Guarda como era antes (vale para todo o passado) na primeira mudança; a nova vale de hoje em diante.
    const antes = await this.fotoDaJornada(client, idColaborador);
    const temHistorico = (await client.query("select 1 from dna_work.ponto_jornada_historico where id_colaborador = $1 limit 1", [idColaborador])).rowCount;
    if (antes && !temHistorico) {
      await client.query(
        "insert into dna_work.ponto_jornada_historico (id_colaborador, desde, dias) values ($1, '0001-01-01', $2) on conflict do nothing",
        [idColaborador, JSON.stringify(antes)],
      );
    }
    const turno = (await client.query<Record<string, number | null>>(
      `select ${DIAS_SEMANA.map(({ chave, coluna }) => `${coluna}, ${chave}_carga`).join(", ")}, modalidade,
              (select tipo_vaga from dna_work.colaborador where id_colaborador = $3) as modalidade_pessoa
       from dna_work.ponto_turno_base where id::text = $1 and id_empresa = $2`,
      [idJornada, empresaId, idColaborador],
    )).rows[0];
    if (!turno) throw new AppError(422, "VALIDACAO", "Escolha a jornada de trabalho.", { jornada: "Escolha a jornada de trabalho." });
    // Jornada de estágio não serve para CLT, nem o contrário (os limites da lei são outros).
    if (turno.modalidade != null && turno.modalidade_pessoa != null && Number(turno.modalidade) !== Number(turno.modalidade_pessoa)) {
      const deQuem = Number(turno.modalidade) === 1 ? "estágio" : "CLT";
      throw new AppError(422, "JORNADA_OUTRA_MODALIDADE", `Esta jornada é de ${deQuem} e não serve para a modalidade da pessoa.`, { jornada: `Jornada de ${deQuem}: escolha uma da mesma modalidade da pessoa.` });
    }
    const dias = DIAS_SEMANA.map(({ chave, coluna }) => ({ trabalha: Number(turno[coluna]) === 1, carga: turno[`${chave}_carga`] }));
    if (dias.some((dia) => dia.trabalha && dia.carga == null)) {
      throw new AppError(422, "JORNADA_INCOMPLETA", "Esta jornada não tem o horário de todos os dias. Complete-a em Jornadas de trabalho.", { jornada: "Jornada sem horário em algum dia." });
    }
    const valores = dias.flatMap((dia) => (dia.trabalha ? ["1", String(dia.carga)] : ["folga", ""]));
    await client.query("delete from dna_work.carga_horaria where id_colaborador = $1", [idColaborador]);
    await client.query(`
      insert into dna_work.carga_horaria (
        id_colaborador, tipo, escala, segunda, segunda_carga, terca, terca_carga, quarta, quarta_carga,
        quinta, quinta_carga, sexta, sexta_carga, sabado, sabado_carga, domingo, domingo_carga
      ) values ($1,'1',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [idColaborador, Number(idJornada), ...valores]);
    const base = dias.find((dia) => dia.trabalha)?.carga ?? null;
    await client.query("update dna_work.colaborador set carga_base = $2 where id_colaborador = $1", [idColaborador, base]);
    const depois = await this.fotoDaJornada(client, idColaborador);
    await client.query(`
      insert into dna_work.ponto_jornada_historico (id_colaborador, desde, dias) values ($1, $2, $3)
      on conflict (id_colaborador, desde) do update set dias = excluded.dias, criado_em = now()
    `, [idColaborador, antes ? dataSp(0) : "0001-01-01", JSON.stringify(depois)]);
  }

  /** Feriados cadastrados pela empresa, como estão no banco (fixo = repete todo ano; facultativo = não para o ponto). */
  private async feriadosCadastrados(empresaId: string) {
    const rows = await this.db.query<{
      id: number; nome: string | null; data: string | null; tipo: string | null; estado: string | null; cidade: string | null; fixo: number | null; facultativo: number | null;
    }>(`
      select id_feriado as id, nome, data, tipo, estado, cidade, fixo, facultativo
      from dna_work.feriados where id_empresa = $1
    `, [empresaId]);
    return rows.rows
      .map((linha) => ({ ...linha, iso: isoDe(linha.data), fixo: Number(linha.fixo) === 1, facultativo: Number(linha.facultativo) === 1 }))
      .filter((linha) => linha.iso);
  }

  /** Calendário do ano: nacionais (BrasilAPI) e os cadastrados pela empresa, já com a data daquele ano. */
  async feriados(usuarioId: string, empresaId: string, anoInformado?: string) {
    await this.garantir(usuarioId, empresaId);
    const ano = /^\d{4}$/.test(anoInformado ?? "") ? Number(anoInformado) : Number(dataSp(0).slice(0, 4));
    const [nacionais, cadastrados] = await Promise.all([feriadosNacionais(ano), this.feriadosCadastrados(empresaId)]);
    const doAno = cadastrados
      .map((linha) => ({ linha, data: dataNoAno(linha.iso!, linha.fixo, ano) }))
      .filter((item): item is { linha: (typeof cadastrados)[number]; data: string } => Boolean(item.data))
      .map(({ linha, data }) => ({
        id: linha.id,
        data,
        nome: (linha.nome ?? "").trim() || "Feriado",
        abrangencia: (ABRANGENCIAS as readonly string[]).includes(linha.tipo ?? "") ? linha.tipo : "empresa",
        local: [linha.cidade, linha.estado].filter(Boolean).join(" / ") || null,
        fixo: linha.fixo,
        facultativo: linha.facultativo,
      }))
      .sort((a, b) => a.data.localeCompare(b.data));
    return { ano, nacionais: nacionais.lista, nacionaisDisponiveis: nacionais.ok, cadastrados: doAno };
  }

  async salvarFeriado(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const campos: Record<string, string> = {};
    const nome = (body.nome ?? "").trim().slice(0, 100);
    if (nome.length < 2) campos.nome = "Informe o nome do feriado.";
    if (!dataValida(body.data)) campos.data = "Informe a data.";
    const abrangencia = body.abrangencia as Abrangencia;
    if (!ABRANGENCIAS.includes(abrangencia)) campos.abrangencia = "Diga se o feriado é municipal, estadual ou só da empresa.";
    const primeiro = Object.values(campos)[0];
    if (primeiro) throw new AppError(422, "VALIDACAO", Object.keys(campos).length > 1 ? "Confira os campos marcados." : primeiro, campos);
    // Municipal e estadual ficam com a cidade e a UF da empresa (cada filial tem o próprio cadastro e os próprios feriados).
    const empresa = (await this.db.query<{ cidade: string | null; uf: string | null }>(
      "select cidade, uf from dna_work.empresa where id_empresa = $1", [empresaId],
    )).rows[0];
    const estado = abrangencia === "empresa" ? null : (empresa?.uf ?? "").trim().toUpperCase().slice(0, 10) || null;
    const cidade = abrangencia === "municipal" ? (empresa?.cidade ?? "").trim().slice(0, 200) || null : null;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const id = await proximoId(client, "feriados");
      await client.query(`
        insert into dna_work.feriados (id_feriado, nome, data, id_empresa, tipo, estado, cidade, fixo, facultativo)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [id, nome, dataLegado(body.data), empresaId, abrangencia, estado, cidade, body.fixo === "1" ? 1 : 0, body.facultativo === "1" ? 1 : 0]);
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async excluirFeriado(usuarioId: string, empresaId: string, id: string) {
    await this.garantir(usuarioId, empresaId);
    const apagado = await this.db.query("delete from dna_work.feriados where id_feriado::text = $1 and id_empresa = $2", [id, empresaId]);
    if (!apagado.rowCount) throw new AppError(404, "FERIADO_NAO_ENCONTRADO", "Feriado não encontrado.");
    return { id };
  }

  /**
   * Dias (YYYY/MM/DD) que contam como feriado no ponto: nacionais e os cadastrados pela empresa, sem os pontos facultativos.
   * Fixo vale em todos os anos do período.
   */
  private async diasDeFeriado(empresaId: string, chaves: string[]) {
    const anos = [...new Set(chaves.map((chave) => Number(chave.slice(0, 4))))];
    const [nacionais, cadastrados] = await Promise.all([
      Promise.all(anos.map((ano) => feriadosNacionais(ano))),
      this.feriadosCadastrados(empresaId),
    ]);
    const dias = new Set<string>();
    for (const lista of nacionais) for (const feriado of lista.lista) dias.add(feriado.data.replaceAll("-", "/"));
    for (const linha of cadastrados) {
      if (linha.facultativo) continue;
      for (const ano of anos) {
        const data = dataNoAno(linha.iso!, linha.fixo, ano);
        if (data) dias.add(data.replaceAll("-", "/"));
      }
    }
    return new Set(chaves.filter((chave) => dias.has(chave)));
  }

  /**
   * Nova senha provisória do app do ponto (esqueceu a senha ou ainda não tinha). A pessoa troca no próximo login.
   * :id = id_candidato, de alguém que é ou foi colaborador desta empresa.
   */
  async redefinirSenhaColaborador(usuarioId: string, empresaId: string, idCandidato: string, senha: string) {
    await this.garantir(usuarioId, empresaId);
    if (senha.length < SENHA_MINIMA) throw new AppError(422, "VALIDACAO", "Use pelo menos 6 caracteres.", { senha: "Use pelo menos 6 caracteres." });
    const daqui = await this.db.query("select 1 from dna_work.colaborador where id_candidato = $1 and id_empresa = $2 limit 1", [idCandidato, empresaId]);
    if (!daqui.rowCount) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado.");
    await gravarSenha(this.db, idCandidato, senha, true);
    return { ok: true };
  }

  async salvarColaborador(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const nome = body.nome?.trim() ?? "";
    const cpf = (body.cpf ?? "").replace(/\D/g, "").slice(0, 11);
    const cargo = (body.cargo ?? "").trim().slice(0, 255);
    if (nome.length < 2) throw new AppError(422, "NOME_CURTO", "Informe o nome do colaborador.");
    if (cpf.length !== 11) throw new AppError(422, "CPF_INVALIDO", "Informe o CPF com 11 números.", { cpf: "Informe o CPF com 11 números." });
    if (!cpfValido(cpf)) throw new AppError(422, "CPF_INVALIDO", "Este CPF não existe. Confira os números.", { cpf: "CPF inválido: confira os números." });
    if (body.inicio && !dataIsoValida(body.inicio)) {
      throw new AppError(422, "VALIDACAO", "Informe uma data de início que exista.", { inicio: "Data inválida." });
    }
    if (cargo.length < 2) throw new AppError(422, "CARGO_CURTO", "Informe o cargo.");
    // Senha do primeiro acesso ao app do ponto: a empresa cria e a pessoa troca no primeiro login.
    const senha = body.senha ?? "";
    if (senha.length < SENHA_MINIMA) {
      throw new AppError(422, "VALIDACAO", "Crie a senha do primeiro acesso com pelo menos 6 caracteres.", { senha: "Use pelo menos 6 caracteres." });
    }
    if (!body.jornada) {
      throw new AppError(422, "VALIDACAO", "Escolha a jornada de trabalho.", { jornada: "Escolha a jornada de trabalho." });
    }
    // A modalidade (1 estágio, 2 CLT) vem da jornada escolhida: ela decide férias ou recesso e os limites da lei.
    const daJornada = (await this.db.query<{ modalidade: number | null }>(
      "select modalidade from dna_work.ponto_turno_base where id::text = $1 and id_empresa = $2",
      [body.jornada, empresaId],
    )).rows[0];
    if (!daJornada) throw new AppError(422, "VALIDACAO", "Escolha a jornada de trabalho.", { jornada: "Escolha a jornada de trabalho." });
    if (daJornada.modalidade !== 1 && daJornada.modalidade !== 2) {
      throw new AppError(422, "JORNADA_SEM_MODALIDADE", "Esta jornada ainda não diz se é de estágio ou CLT. Complete-a em Jornadas de trabalho.", { jornada: "Jornada sem modalidade: complete-a em Jornadas de trabalho." });
    }
    const modalidade = daJornada.modalidade;
    // Sem data, começa hoje no horário de Brasília (em UTC, depois das 21h já seria amanhã).
    const inicio = dataLegado(body.inicio || dataSp(0));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      // Trava pelo CPF: dois cadastros do mesmo CPF ao mesmo tempo viravam duas pessoas iguais (e o login só achava uma).
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`colaborador-cpf-${cpf}`]);
      const existente = await client.query<{ id_candidato: string }>(`
        select id_candidato from dna_work.candidato
        where regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = $1
        limit 1
      `, [cpf]);
      const idCandidato = existente.rows[0]?.id_candidato ?? crypto.randomUUID();
      if (existente.rows[0]) {
        const passagens = (await client.query<{ ativo: boolean; aqui: boolean }>(
          "select coalesce(status_colaborador, 1) = 1 as ativo, id_empresa = $2 as aqui from dna_work.colaborador where id_candidato = $1",
          [idCandidato, empresaId],
        )).rows;
        // Ativo em outra empresa: não pode ser puxado para cá (trocaria a empresa e a senha do ponto da pessoa lá).
        // A mensagem não diz qual empresa (LGPD).
        if (passagens.some((linha) => linha.ativo && !linha.aqui)) {
          throw new AppError(409, "CPF_EM_OUTRA_EMPRESA", "Este CPF está ativo como colaborador em outra empresa. Ela precisa desligar a pessoa antes do cadastro aqui. Se precisar de ajuda, fale com a DNA Work.", { cpf: "CPF ativo em outra empresa." });
        }
        // Mesmo CPF já passou por esta empresa: ativo = cadastro repetido; desligado = pergunta se reativa.
        const daqui = passagens.filter((linha) => linha.aqui);
        if (daqui.some((linha) => linha.ativo)) {
          throw new AppError(409, "COLABORADOR_JA_CADASTRADO", "Já existe um colaborador ativo com este CPF.", { cpf: "Este CPF já está cadastrado." });
        }
        if (daqui.length && body.reativar !== "1") {
          throw new AppError(409, "COLABORADOR_DESLIGADO", "Esta pessoa já trabalhou aqui e está desligada.");
        }
      }
      if (!existente.rows[0]) {
        await client.query(`
          insert into dna_work.candidato (id_candidato, nome, cpf, email, celular, datacadastro, id_empresa, colaborador)
          values ($1,$2,$3,$4,$5,$6,$7,1)
        `, [idCandidato, nome, cpf, body.email?.trim() || null, (body.celular ?? "").trim().slice(0, 40) || null, inicio, empresaId]);
      } else {
        // Candidato já existente (desligado daqui ou de outra empresa, ou vindo da base da DNA): passa a ser colaborador
        // desta empresa, como o interno faz na contratação (o login do ponto exige candidato.id_empresa = empresa).
        await client.query(
          "update dna_work.candidato set colaborador = 1, id_empresa = $2 where id_candidato = $1",
          [idCandidato, empresaId],
        );
      }
      const idColaborador = crypto.randomUUID();
      await client.query(`
        insert into dna_work.colaborador
          (id_colaborador, id_candidato, id_empresa, data_inicio, departamento, cargo, data_cadastro, status_ponto, status_colaborador, tipo_vaga)
        values ($1,$2,$3,$4,$5,$6,$7,1,1,$8)
      `, [
        idColaborador, idCandidato, empresaId, inicio, body.departamento?.trim().slice(0, 255) || null, cargo,
        dataLegado(dataSp(0)),
        // Modalidade (dna_work.modalidade_vaga): 1 estágio, 2 CLT, a da jornada. Sem contratação pela DNA, a lista tira daqui.
        modalidade,
      ]);
      // Os dias e horários de trabalho entram junto com o cadastro: sem eles o ponto trata todo dia como folga.
      await this.aplicarJornada(client, idColaborador, empresaId, body.jornada ?? "");
      await gravarSenha(client, idCandidato, senha, true);
      await client.query("COMMIT");
      return { id: idColaborador };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Abre a vaga no interno (POST /api/v1/servico/vagas), que grava no Lightsail, em public.vaga e em dna_work.vaga
   * como a "Nova vaga" de lá. Sem o interno configurado, ou com a empresa fora do cadastro novo do interno,
   * grava só em dna_work.vaga (aparece em Vagas do interno, mas não na triagem).
   */
  async salvarVaga(usuarioId: string, empresaId: string, body: Record<string, string>, email = "") {
    await this.garantir(usuarioId, empresaId);
    const vaga = validarVaga(body);
    if (this.interno.url && this.interno.token && UUID.test(empresaId)) {
      const resposta = await postServico(this.interno.url, this.interno.token, "/api/v1/servico/vagas", {
        empresa_id: empresaId,
        tipo: vaga.tipo === 1 ? "estagio" : "clt",
        quantidade: vaga.quantidade,
        carga_horaria: vaga.cargaHoraria,
        novo_cargo: { nome: vaga.cargo, descricao: vaga.atividades, requisitos: vaga.requisitos },
        salario: vaga.salario,
        horario_entrada: vaga.entrada,
        horario_saida: vaga.saida,
        ...(vaga.sabado ? { sab_entrada: vaga.sabado.entrada, sab_saida: vaga.sabado.saida } : {}),
        sexo: vaga.sexo,
        idade: vaga.idade,
        idade_ate: vaga.idadeAte,
        atividades: vaga.atividades,
        beneficios: vaga.beneficios ?? undefined,
        ...(vaga.tipo === 1 ? { aceita_ensino_medio: vaga.aceitaMedio } : {}),
        // O interno corta "Portal empresa: <usuario>" em 40 caracteres (log_diversos.usuario é varchar(40)).
        usuario: email,
      });
      const dados = resposta.body?.data as { ids?: string[]; codigo?: string } | undefined;
      if (resposta.status === 201 && dados?.ids?.length) return { id: dados.ids[0], codigo: dados.codigo ?? null, interno: true };
      const codigo = resposta.body?.error?.code;
      if (codigo !== "EMPRESA_FORA_DA_TELA") {
        this.avisar("vaga: interno recusou ou não respondeu", { status: resposta.status, codigo, empresaId });
        if (resposta.status === 422 && resposta.body?.error?.message) throw new AppError(422, "VALIDACAO", resposta.body.error.message);
        throw new AppError(503, "INTERNO_INDISPONIVEL", "Não foi possível abrir a vaga agora. Nada foi gravado; tente de novo em instantes.");
      }
      this.avisar("vaga: empresa fora do cadastro novo do interno, gravando só em dna_work.vaga", { empresaId });
    } else {
      this.avisar("vaga: interno não configurado ou empresa sem UUID, gravando só em dna_work.vaga", { empresaId });
    }
    const id = crypto.randomUUID();
    // dna_work.vaga.comparador é varchar(30): o UUID (36) estourava a coluna. Mesmo formato do cadastro público.
    const comparador = crypto.randomBytes(8).toString("hex");
    const texto = vaga.sabado
      ? `Segunda a sexta, ${vaga.entrada} às ${vaga.saida}; sábado, ${vaga.sabado.entrada} às ${vaga.sabado.saida}`
      : `${vaga.entrada} às ${vaga.saida}`;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        insert into dna_work.vaga
          (id_vaga, id_empresa, cargo, tipo_vaga, salario, status, dataabertura, comparador, quantidade_posicoes,
           texto_carga, horabase, hora_saida_base, carga_horaria, atribuicaoes, requisitos_desejaveis, beneficios_texto,
           sexo, idade, idadeate, escolaridade, sede, publicar, faturar, km, data_adicao)
        values ($1,$2,$3,$4,$5,0,$6,$19,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$20,1,'S','30',now())
      `, [
        id, empresaId, vaga.cargo, vaga.tipo, vaga.salario, dataLegado(new Date().toISOString().slice(0, 10)), vaga.quantidade,
        texto, vaga.entrada, vaga.saida, vaga.cargaHoraria, vaga.atividades, vaga.requisitos.slice(0, 255), vaga.beneficios,
        vaga.sexo, String(vaga.idade), String(vaga.idadeAte), vaga.tipo === 1 && vaga.aceitaMedio ? ESCOLARIDADE_ENSINO_MEDIO : null,
        comparador, SEDE_DNA,
      ]);
      await gravarValoresPadraoDaVaga(client, comparador);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { id, codigo: null, interno: false };
  }

  /**
   * Cancela a vaga como a edição do interno faz: status 6 ("cancelada", situação Fechada) em dna_work.vaga, em todas as
   * posições da vaga (mesmo comparador). A triagem do interno tira a vaga de public.vaga na próxima busca.
   * Só vaga aberta ou pausada: 4 (confecção de contrato) e 1 (contratada) mexem em contratação e faturamento.
   */
  async cancelarVaga(usuarioId: string, empresaId: string, idVaga: string, email = "") {
    await this.garantir(usuarioId, empresaId);
    const atual = await this.db.query<{ comparador: string | null; status: number | null }>(
      "select comparador, status from dna_work.vaga where id_vaga = $1 and id_empresa = $2",
      [idVaga, empresaId],
    );
    const vaga = atual.rows[0];
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    const status = Number(vaga.status);
    if (status === 4) throw new AppError(409, "VAGA_EM_CONTRATO", "Esta vaga já está com contrato em preparação. Fale com a DNA Work para cancelar.");
    if (!STATUS_CANCELAVEL.includes(status)) throw new AppError(409, "VAGA_NAO_ABERTA", "Só dá para cancelar vaga aberta ou pausada.");
    const hoje = dataLegado(dataSp(0));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const canceladas = await client.query<{ id_vaga: string }>(`
        update dna_work.vaga
        set status = $4, dataencerramento = $5, data_status = $5
        where id_empresa = $1
          and coalesce(nullif(btrim(comparador), ''), id_vaga) = coalesce(nullif(btrim($2::text), ''), $3::text)
          and status = any($6::int[])
        returning id_vaga
      `, [empresaId, vaga.comparador, idVaga, STATUS_CANCELADA, hoje, STATUS_CANCELAVEL]);
      for (const linha of canceladas.rows) {
        // log_diversos: usuario e acao são varchar(40).
        await client.query(
          "insert into dna_work.log_diversos (usuario, id_empresa, id_vaga, acao, data) values ($1,$2,$3,$4, now())",
          [`Portal empresa: ${email}`.slice(0, 40), empresaId, linha.id_vaga, "Vaga cancelada Portal empresa"],
        );
      }
      await client.query("COMMIT");
      return { canceladas: canceladas.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Relatório de ponto do período (padrão: a semana atual, de segunda até hoje), uma linha por colaborador: horas feitas,
   * previstas, saldo do período, saldo total do contrato e ocorrências. Entra quem está ativo e quem foi desligado
   * dentro do período.
   */
  /** Pedidos de ajuste de ponto dos colaboradores da empresa (tabela antiga "justificativa"). Pendentes primeiro. */
  async solicitacoesPonto(usuarioId: string, empresaId: string, situacao: "pendentes" | "todas", permitidos: Set<string> | null = null) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query<{
      id: number; id_candidato: string; nome: string | null; data: string; tipo: string; hora: string | null; texto: string | null;
      aceite: number | null; resposta: string | null; entrada: string | null; saida: string | null; entrada_atual: string | null; saida_atual: string | null;
    }>(`
      select j.id, col.id_candidato, c.nome, t.data, j.tipo, j.hora, j.texto, j.aceite, j.resposta, t.entrada, t.saida,
             coalesce(nullif(t.entrada_editado, ''), t.entrada) as entrada_atual, coalesce(nullif(t.saida_editado, ''), t.saida) as saida_atual
      from dna_work.justificativa j
      join dna_work.tabela_ponto t on t.id = j.id_ponto
      join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1 and j.tipo in ('entrada', 'saida') and ($2 = 'todas' or j.aceite is null)
      order by (j.aceite is null) desc, t.data desc, j.id desc
      limit 300
    `, [empresaId, situacao]);
    const inclusoes = await this.db.query<{ id: number; id_candidato: string; nome: string | null; data: string; entrada: string; saida: string | null; motivo: string; aceite: number | null; resposta: string | null }>(`
      select i.id, col.id_candidato, c.nome, i.data, i.entrada, i.saida, i.motivo, i.aceite, i.resposta
      from dna_work.ponto_inclusao i
      join dna_work.colaborador col on col.id_colaborador = i.id_colaborador
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1 and ($2 = 'todas' or i.aceite is null)
      order by i.data desc, i.id desc
      limit 300
    `, [empresaId, situacao]);
    const br = (data: string) => data.replaceAll("-", "/").split("/").reverse().join("/");
    const nomeSituacao = (aceite: number | null) => (aceite === 1 ? "Aprovada" : aceite === 0 ? "Recusada" : "Pendente");
    const todos = [
      ...rows.rows.map((linha) => ({
        origem: "ajuste" as const,
        id: linha.id,
        id_candidato: linha.id_candidato,
        nome: linha.nome ?? "",
        dataIso: linha.data.replaceAll("/", "-"),
        data: br(linha.data),
        tipo: linha.tipo === "saida" ? "Saída" : "Entrada",
        // O que o relógio gravou (não muda nunca) e o que vale hoje (pode já ter sido ajustado).
        registrado: (linha.tipo === "saida" ? linha.saida : linha.entrada) || "",
        atual: (linha.tipo === "saida" ? linha.saida_atual : linha.entrada_atual) || "",
        pedido: (linha.hora ?? "").slice(0, 5),
        motivo: linha.texto ?? "",
        situacao: nomeSituacao(linha.aceite),
        resposta: linha.resposta ?? "",
      })),
      ...inclusoes.rows.map((linha) => ({
        origem: "inclusao" as const,
        id: linha.id,
        id_candidato: linha.id_candidato,
        nome: linha.nome ?? "",
        dataIso: linha.data.replaceAll("/", "-"),
        data: br(linha.data),
        tipo: "Inclusão",
        registrado: "",
        atual: "",
        pedido: `${linha.entrada} às ${linha.saida ?? "—"}`,
        motivo: linha.motivo,
        situacao: nomeSituacao(linha.aceite),
        resposta: linha.resposta ?? "",
      })),
    ];
    // Usuário com acesso limitado só vê os pedidos dos colaboradores liberados para ele.
    return todos.filter((pedido) => !permitidos || permitidos.has(pedido.id_candidato)).sort((a, b) => (a.situacao === "Pendente" ? 0 : 1) - (b.situacao === "Pendente" ? 0 : 1) || b.dataIso.localeCompare(a.dataIso));
  }

  /**
   * Aprova ou recusa a inclusão de um período esquecido. Aprovada, vira uma batida sem horário do relógio (entrada e
   * saida vazias) e só com os horários corrigidos, marcada como tratada por quem aprovou: assim fica identificada como
   * marcação incluída, e o motivo, quem aprovou e quando ficam em ponto_inclusao (Portaria 671/2021).
   */
  async responderInclusao(usuarioId: string, empresaId: string, id: number, aprovar: boolean, respostaInformada: string, gestor: string | null = null) {
    await this.garantir(usuarioId, empresaId);
    const resposta = respostaInformada.trim().slice(0, 255);
    if (!aprovar && resposta.length < 3) {
      throw new AppError(422, "VALIDACAO", "Diga ao colaborador por que o pedido foi recusado.", { resposta: "Diga ao colaborador por que o pedido foi recusado." });
    }
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const pedido = (await client.query<{ id_colaborador: string; data: string; entrada: string; saida: string | null; aceite: number | null }>(`
        select i.id_colaborador, i.data, i.entrada, i.saida, i.aceite
        from dna_work.ponto_inclusao i
        join dna_work.colaborador col on col.id_colaborador = i.id_colaborador
        where i.id = $1 and col.id_empresa = $2
        for update of i
      `, [id, empresaId])).rows[0];
      if (!pedido) throw new AppError(404, "SOLICITACAO_NAO_ENCONTRADA", "Pedido não encontrado.");
      if (pedido.aceite !== null) throw new AppError(409, "SOLICITACAO_RESPONDIDA", "Esse pedido já foi respondido.");
      let idPonto: number | null = null;
      if (aprovar) {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inclusao-${pedido.id_colaborador}`]);
        // Desde o pedido pode ter entrado outra batida no mesmo horário: confere de novo (sem contar este pedido).
        await client.query("update dna_work.ponto_inclusao set aceite = -1 where id = $1", [id]);
        await conferirSobreposicao(client, pedido.id_colaborador, pedido.data, pedido.entrada, pedido.saida ?? pedido.entrada);
        idPonto = await proximoId(client, "tabela_ponto");
        const entrada = `${pedido.entrada}:00`;
        const saida = pedido.saida ? `${pedido.saida}:00` : null;
        await client.query(`
          insert into dna_work.tabela_ponto
            (id, id_colaborador, data, entrada, entrada_editado, saida, saida_editado, tratado_entrada, tratado_saida,
             id_usu_tratado_entrada, id_usu_tratado_saida, horas_trabalhadas, dispositivo_entrada)
          values ($1,$2,$3,null,$4,null,$5,1,$6,$7,$8,$9,'Inclusão aprovada pela empresa')
        `, [
          idPonto, pedido.id_colaborador, pedido.data, entrada, saida, saida ? 1 : null, usuarioId, saida ? usuarioId : null,
          saida ? horasEntreRelogio(entrada, saida) : null,
        ]);
      }
      await client.query(
        "update dna_work.ponto_inclusao set aceite = $2, resposta = $3, id_ponto = $4, id_usuario = $5, id_gestor = $6, respondido_em = now() where id = $1",
        [id, aprovar ? 1 : 0, resposta || null, idPonto, usuarioId, gestor],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Aprova ou recusa um pedido de ajuste. Aprovado, o horário vai para entrada_editado/saida_editado e a marcação
   * original fica guardada (Portaria 671/2021, o registro do relógio não pode ser alterado), como o sistema antigo faz.
   */
  async responderSolicitacao(usuarioId: string, empresaId: string, id: number, aprovar: boolean, respostaInformada: string, gestor: string | null = null) {
    await this.garantir(usuarioId, empresaId);
    const resposta = respostaInformada.trim().slice(0, 255);
    if (!aprovar && resposta.length < 3) {
      throw new AppError(422, "VALIDACAO", "Diga ao colaborador por que o pedido foi recusado.", { resposta: "Diga ao colaborador por que o pedido foi recusado." });
    }
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const pedido = (await client.query<{ id_ponto: number; tipo: string; hora: string | null; aceite: number | null; entrada: string | null; saida: string | null }>(`
        select j.id_ponto, j.tipo, j.hora, j.aceite,
               coalesce(nullif(t.entrada_editado, ''), t.entrada) as entrada, coalesce(nullif(t.saida_editado, ''), t.saida) as saida
        from dna_work.justificativa j
        join dna_work.tabela_ponto t on t.id = j.id_ponto
        join dna_work.colaborador col on col.id_colaborador = t.id_colaborador
        where j.id = $1 and col.id_empresa = $2
        for update of j
      `, [id, empresaId])).rows[0];
      if (!pedido) throw new AppError(404, "SOLICITACAO_NAO_ENCONTRADA", "Pedido não encontrado.");
      if (pedido.aceite !== null) throw new AppError(409, "SOLICITACAO_RESPONDIDA", "Esse pedido já foi respondido.");
      if (aprovar) {
        const hora = `${(pedido.hora ?? "").slice(0, 5)}:00`;
        if (!/^\d{2}:\d{2}:00$/.test(hora)) throw new AppError(422, "HORA_INVALIDA", "O horário pedido não é válido.");
        const entrada = pedido.tipo === "entrada" ? hora : pedido.entrada;
        const saida = pedido.tipo === "saida" ? hora : pedido.saida;
        conferirPar(entrada, saida, "hora");
        const lado = pedido.tipo === "saida" ? "saida" : "entrada";
        await client.query(`
          update dna_work.tabela_ponto
          set ${lado}_editado = $2, tratado_${lado} = 1, id_usu_tratado_${lado} = $3, horas_trabalhadas = coalesce($4, horas_trabalhadas)
          where id = $1
        `, [pedido.id_ponto, hora, usuarioId, entrada && saida ? horasEntreRelogio(entrada, saida) : null]);
      }
      await client.query("update dna_work.justificativa set aceite = $2, resposta = $3, id_gestor = $4 where id = $1", [id, aprovar ? 1 : 0, resposta || null, gestor]);
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async relatorioPonto(usuarioId: string, empresaId: string, deInformado?: string, ateInformado?: string, permitidos: Set<string> | null = null) {
    await this.garantir(usuarioId, empresaId);
    const hoje = dataSp(0);
    const diaDaSemana = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7;
    let de = dataValida(deInformado) ?? dataSpDe(hoje, -diaDaSemana);
    let ate = dataValida(ateInformado) ?? hoje;
    if (ate < de) [de, ate] = [ate, de];
    if (intervalo(de, ate).length > 370) throw new AppError(422, "PERIODO_LONGO", "Escolha um período de até um ano.");
    const pessoas = (await this.db.query<{ id_candidato: string; nome: string | null; cargo: string | null; departamento: string | null; jornada: string | null; ativo: boolean }>(`
      select distinct on (col.id_candidato) col.id_candidato, c.nome, col.cargo, col.departamento, esc.nome as jornada,
             coalesce(col.status_colaborador, 1) = 1 as ativo
      from dna_work.colaborador col
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      left join lateral (select escala from dna_work.carga_horaria ch where ch.id_colaborador = col.id_colaborador limit 1) ch on true
      left join dna_work.ponto_turno_base esc on esc.id = ch.escala and esc.id_empresa = col.id_empresa
      where col.id_empresa = $1
        and (coalesce(col.status_colaborador, 1) = 1 or replace(col.data_desligamento, '/', '-') >= $2)
      order by col.id_candidato, case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last
    `, [empresaId, de])).rows.filter((pessoa) => !permitidos || permitidos.has(pessoa.id_candidato));
    // Poucas consultas por vez, para não esgotar as conexões com empresas grandes.
    const linhas: Array<Record<string, unknown>> = [];
    for (let i = 0; i < pessoas.length; i += 6) {
      const lote = await Promise.all(pessoas.slice(i, i + 6).map(async (pessoa) => {
        const relatorio = await this.montarRelatorioPonto(empresaId, pessoa.id_candidato, de, ate);
        if (relatorio.semRegistro) return null;
        const total = relatorio.inicioContrato
          ? (await this.montarRelatorioPonto(empresaId, pessoa.id_candidato, relatorio.inicioContrato, hoje)).periodo
          : null;
        return {
          id_candidato: pessoa.id_candidato,
          nome: pessoa.nome ?? "",
          cargo: pessoa.cargo ?? "",
          departamento: pessoa.departamento ?? "",
          jornada: pessoa.jornada ?? "",
          modalidade: relatorio.estagio ? "Estágio" : "CLT",
          situacao: relatorio.desligado ? "Desligado" : "Ativo",
          ...relatorio.periodo,
          saldoTotal: total?.saldo ?? null,
          // Estágio não pode passar da jornada (Lei 11.788/2008, art. 10): saldo positivo é alerta, não crédito.
          // Basta um dia acima da jornada: o saldo do período esconderia isso quando há faltas.
          estagioAcima: relatorio.estagio && relatorio.dias.some((dia) => !dia.anterior && dia.saldoSegundos > 0),
        };
      }));
      linhas.push(...lote.filter((linha): linha is NonNullable<typeof linha> => Boolean(linha)));
    }
    linhas.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    return { de, ate, linhas };
  }

  /**
   * Relatório de ponto da pessoa. Cada contratação/reativação é uma passagem (linha própria em dna_work.colaborador, com
   * batidas e saldo próprios). Sem filtro de data: só a passagem atual, a partir do início dela (quem foi reativado
   * começa do zero). Com filtro de data: cada dia sai da passagem que valia naquele dia, para consultar o ponto de
   * contratações anteriores (obrigação legal de guarda), sem misturar o saldo de uma com o da outra.
   */
  async relatorioPontoColaborador(usuarioId: string, empresaId: string, idCandidato: string, de?: string, ate?: string) {
    await this.garantir(usuarioId, empresaId);
    if (dataValida(de) && dataValida(ate) && intervalo(de!, ate!).length > 370) {
      throw new AppError(422, "PERIODO_LONGO", "Escolha um período de até um ano.");
    }
    const relatorio = await this.montarRelatorioPonto(empresaId, idCandidato, de, ate);
    // Saldo total do contrato atual: do início dele até hoje (a página mostra junto do saldo do período).
    const total = !relatorio.semRegistro && relatorio.inicioContrato
      ? (await this.montarRelatorioPonto(empresaId, idCandidato, relatorio.inicioContrato, dataSp(0))).periodo
      : null;
    return { ...relatorio, total };
  }

  private async montarRelatorioPonto(empresaId: string, idCandidato: string, de?: string, ate?: string) {
    const pessoa = await this.db.query<{
      id_colaborador: string; nome: string | null; cargo: string | null; banco_horas: string | null; modalidade: string | null; ativo: boolean;
      cpf: string | null; email: string | null; celular: string | null; departamento: string | null; data_inicio: string | null;
      data_desligamento: string | null;
    }>(`
      select col.id_colaborador, c.nome, coalesce(nullif(btrim(col.cargo), ''), v.cargo) as cargo, col.banco_horas::text,
             coalesce(col.tipo_vaga, v.tipo_vaga)::text as modalidade, coalesce(col.status_colaborador, 1) = 1 as ativo,
             c.cpf, c.email, c.celular, col.departamento, replace(col.data_inicio, '/', '-') as data_inicio,
             replace(col.data_desligamento, '/', '-') as data_desligamento
      from dna_work.colaborador col
      join dna_work.candidato c on c.id_candidato = col.id_candidato
      left join lateral (
        select v.cargo, v.tipo_vaga
        from dna_work.conratacaovaga cv
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        where cv.id_candidato = c.id_candidato
          and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = col.id_empresa
        order by cv.data_contratacao desc nulls last
        limit 1
      ) v on true
      where col.id_candidato = $1 and col.id_empresa = $2
      order by case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last, col.data_inicio desc nulls last
    `, [idCandidato, empresaId]);
    // A atual (ativa, ou a mais recente) vem primeiro.
    const colaborador = pessoa.rows[0];
    if (!colaborador) {
      const contrato = await this.db.query<{ nome: string | null; cargo: string | null }>(`
        select c.nome, v.cargo
        from dna_work.candidato c
        left join dna_work.conratacaovaga cv on cv.id_candidato = c.id_candidato
        left join dna_work.vaga v on v.id_vaga = cv.id_vaga
        where c.id_candidato = $1
          and (
            exists (select 1 from dna_work.colaborador col where col.id_candidato = c.id_candidato and col.id_empresa = $2)
            or coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
            or c.id_empresa = $2
          )
        limit 1
      `, [idCandidato, empresaId]);
      const linha = contrato.rows[0];
      if (!linha) throw new AppError(404, "COLABORADOR_NAO_ENCONTRADO", "Colaborador não encontrado nesta empresa.");
      return {
        nome: linha.nome ?? "", cargo: linha.cargo ?? "", bancoHoras: false, semRegistro: true, estagio: false, desligado: false,
        inicioContrato: "", temAnterior: false, periodo: resumoDoPeriodo([]), periodoAnterior: null, de: de ?? "", ate: ate ?? "", dias: [] as never[],
      };
    }

    let fim = dataValida(ate) ?? dataSp(0);
    let inicio = dataValida(de) ?? dataSp(-6);
    const filtrou = Boolean(dataValida(de) || dataValida(ate));
    if (!filtrou) {
      const ultimo = await this.db.query<{ data: string | null }>(`
        select max(data) as data from dna_work.banco_horas
        where id_colaborador = $1 and data ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'
      `, [colaborador.id_colaborador]);
      const registrada = ultimo.rows[0]?.data?.replaceAll("/", "-");
      if (registrada && registrada < inicio) {
        fim = registrada;
        inicio = dataSpDe(registrada, -6);
      }
    }
    // De qual passagem é cada dia. Antes do início de todas, a pessoa não trabalhava aqui: o dia não entra.
    const inicioDe = (linha: { data_inicio: string | null }) => (/^\d{4}-\d{2}-\d{2}$/.test(linha.data_inicio ?? "") ? linha.data_inicio! : "");
    // Sem filtro, o período mostrado (e devolvido para a tela) começa no contrato atual.
    if (!filtrou && inicioDe(colaborador) > inicio && inicioDe(colaborador) <= fim) inicio = inicioDe(colaborador);
    const porInicio = [...pessoa.rows].sort((a, b) => inicioDe(a).localeCompare(inicioDe(b)));
    const donoDoDia = (dia: string) => {
      if (!filtrou) return !inicioDe(colaborador) || dia >= inicioDe(colaborador) ? colaborador : undefined;
      let dono: (typeof pessoa.rows)[number] | undefined;
      for (const linha of porInicio) if (!inicioDe(linha) || inicioDe(linha) <= dia) dono = linha;
      // A atual vale do início dela em diante, mesmo que uma anterior tenha início mais tarde por erro de cadastro.
      return inicioDe(colaborador) && dia >= inicioDe(colaborador) ? colaborador : dono;
    };
    const hoje = dataSp(0);
    // Dia futuro ainda não aconteceu; depois do último dia de trabalho (desligamento) a pessoa não trabalhava mais aqui.
    const dias = intervalo(inicio, fim).flatMap((dia) => {
      if (dia > hoje) return [];
      const dono = donoDoDia(dia);
      if (!dono) return [];
      if (dono.data_desligamento && /^\d{4}-\d{2}-\d{2}$/.test(dono.data_desligamento) && dia > dono.data_desligamento) return [];
      return [{ iso: dia, dono }];
    });
    const chaves = dias.map((dia) => dia.iso.replaceAll("-", "/"));
    const ids = [...new Set(dias.map((dia) => dia.dono.id_colaborador))];
    const historico = (await this.db.query<{ id: string; desde: string; dias: FotoJornada }>(
      "select id_colaborador as id, desde, dias from dna_work.ponto_jornada_historico where id_colaborador = any($1) order by desde",
      [ids],
    )).rows;
    // Jornada que valia no dia (a mais recente com início até ele); sem histórico, a atual.
    const jornadaDoDia = (id: string, iso: string) => {
      let achada: FotoJornada | undefined;
      for (const linha of historico) if (linha.id === id && linha.desde <= iso) achada = linha.dias;
      return achada;
    };
    const [banco, pontos, escala, feriados, marcados, cargas, ferias, atestados] = await Promise.all([
      this.db.query<{ id: string; data: string; horas_trabalhadas: string | null; saldo_dia: string | null; saldo_bh: string | null; folga: number | null; carga_horaria: number | null }>(`
        select id_colaborador::text as id, data, horas_trabalhadas, saldo_dia, saldo_bh, folga, carga_horaria
        from dna_work.banco_horas
        where id_colaborador::text = any($1) and data = any($2::text[])
      `, [ids, chaves]),
      // Ordem das batidas do dia pelo horário de entrada (uma marcação incluída depois tem id maior, mas pode ser de
      // manhã). Cuidado: "id" aqui é o apelido do colaborador.
      this.db.query<{ id: string; data: string; entrada: string | null; saida: string | null; horas: string | null; ajustada: boolean }>(`
        select t.id_colaborador::text as id, t.data,
               coalesce(nullif(btrim(t.entrada_editado), ''), t.entrada) as entrada,
               coalesce(nullif(btrim(t.saida_editado), ''), t.saida) as saida,
               t.horas_trabalhadas as horas,
               (coalesce(t.tratado_entrada, 0) = 1 or coalesce(t.tratado_saida, 0) = 1) as ajustada
        from dna_work.tabela_ponto t
        where t.id_colaborador::text = any($1) and t.data = any($2::text[]) and coalesce(t.excluido, 0) = 0
        order by t.data, coalesce(nullif(btrim(t.entrada_editado), ''), t.entrada), t.id
      `, [ids, chaves]),
      this.db.query<Record<string, string | null>>(`
        select distinct on (id_colaborador) id_colaborador::text as id,
               segunda, segunda_carga::text, terca, terca_carga::text, quarta, quarta_carga::text,
               quinta, quinta_carga::text, sexta, sexta_carga::text, sabado, sabado_carga::text, domingo, domingo_carga::text
        from dna_work.carga_horaria where id_colaborador::text = any($1)
      `, [ids]),
      this.diasDeFeriado(empresaId, chaves),
      this.db.query<{ id: string; data: string; id_carga_horaria: string | null; id_escala: string | null }>(`
        select id_colaborador::text as id, replace(data, '-', '/') as data, id_carga_horaria::text, id_escala::text
        from dna_work.ponto_data_trabalho
        where id_colaborador::text = any($1) and replace(data, '-', '/') = any($2::text[])
      `, [ids, chaves]),
      this.db.query<CargaBase>(`
        select ${COLUNAS_CARGA} from dna_work.ponto_carga_base where id_empresa = $1
      `, [empresaId]),
      this.db.query<{ id: string; inicio: string; fim: string }>(
        "select id_colaborador::text as id, replace(inicio, '-', '/') as inicio, replace(fim, '-', '/') as fim from dna_work.ferias where id_colaborador::text = any($1)",
        [ids],
      ),
      // Atestado do dia inteiro: dia justificado, não é falta nem conta carga.
      this.db.query<{ id: string; data: string }>(
        "select id_colaborador::text as id, replace(data, '-', '/') as data from dna_work.atestado_medico where id_colaborador::text = any($1) and replace(data, '-', '/') = any($2::text[]) and dia_completo::text = '1'",
        [ids, chaves],
      ),
    ]);
    const comAtestado = new Set(atestados.rows.map((linha) => `${linha.id}|${linha.data}`));
    const chave2 = (id: string, data: string) => `${id}|${data}`;
    const porBanco = new Map(banco.rows.map((linha) => [chave2(linha.id, linha.data), linha]));
    const porPonto = new Map<string, Array<{ entrada: string | null; saida: string | null; horas: string | null; ajustada: boolean }>>();
    for (const ponto of pontos.rows) {
      const lista = porPonto.get(chave2(ponto.id, ponto.data)) ?? [];
      lista.push(ponto);
      porPonto.set(chave2(ponto.id, ponto.data), lista);
    }
    const porMarca = new Map(marcados.rows.map((linha) => [chave2(linha.id, linha.data), linha]));
    const porCarga = new Map(cargas.rows.map((linha) => [String(linha.id), linha]));
    const porEscala = new Map(escala.rows.map((linha) => [String(linha.id), linha]));
    const feriado = feriados;
    const emFerias = (id: string, chave: string) => ferias.rows.some((periodo) => periodo.id === id && periodo.inicio <= chave && periodo.fim >= chave);
    const usaBanco = colaborador.banco_horas === "1";
    // Estagiário não tem férias da CLT: tem recesso (Lei 11.788/2008, art. 13). Modalidade 1 = Estágio.
    const estagio = colaborador.modalidade === "1";
    const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
    const campos = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

    const linhas = dias.map(({ iso, dono }) => {
      const id = dono.id_colaborador;
      const chave = iso.replaceAll("-", "/");
      const indice = new Date(`${iso}T12:00:00Z`).getUTCDay();
      const hora = porBanco.get(chave2(id, chave));
      const marca = porMarca.get(chave2(id, chave));
      const semana = porEscala.get(id);
      const campo = campos[indice];
      // Jornada que valia naquele dia: mudar a jornada depois não muda o espelho do passado.
      const foto = jornadaDoDia(id, iso)?.[campo];
      const trabalha = marca
        ? marca.id_escala === "1"
        : foto
          ? foto.trabalha
          : semana?.[campo] === "1";
      const idCarga = marca?.id_carga_horaria || (!foto && trabalha ? semana?.[`${campo}_carga`] : null) || (!foto && hora?.carga_horaria ? String(hora.carga_horaria) : null);
      const carga = idCarga && idCarga !== "0" ? porCarga.get(idCarga) : foto?.trabalha ? foto.carga ?? undefined : undefined;
      const batidas = ordenarBatidas(porPonto.get(chave2(id, chave)) ?? [], carga);
      const deFerias = emFerias(id, chave);
      const atestado = comAtestado.has(`${id}|${chave}`);
      const contaCarga = !(deFerias || atestado || feriado.has(chave) || !trabalha);
      // Hora noturna reduzida (CLT, art. 73): cada hora de relógio entre 22h e 5h conta 8/7 nas feitas e nas previstas,
      // então quem cumpre a jornada noturna fica com saldo zero. Não vale para estágio (a Lei 11.788 não prevê).
      const reduzida = (segundos: number) => (dono.modalidade === "1" ? 0 : Math.round(segundos / 7));
      const noturnoFeito = segundosNoturnos(trechosDasBatidas(batidas));
      const noturnoPrevisto = contaCarga ? segundosNoturnos(trechosDaCarga(carga)) : 0;
      const segundosFeitos = segundosTrabalhados(batidas, hora?.horas_trabalhadas) + reduzida(noturnoFeito);
      const segundosCarga = (contaCarga ? minutosDaCarga(carga) * 60 : 0) + reduzida(noturnoPrevisto);
      const minutosCarga = paraMinutos(segundosCarga);
      const segundosNoturnosDia = noturnoFeito + reduzida(noturnoFeito);
      // O dia aparece arredondado para o minuto mais perto; as somas usam os segundos.
      const minutosFeitos = paraMinutos(segundosFeitos);
      const primeira = batidas[0];
      const segundaBatida = batidas[1];
      // Hoje, com o dia ainda aberto (sem batida ou com uma saída pendente), não dá para dizer falta nem saldo.
      const emAndamento = iso === hoje && (!batidas.length || !batidas[batidas.length - 1].saida);
      let situacao = "";
      if (!primeira?.entrada) {
        if (deFerias) situacao = dono.modalidade === "1" ? "Recesso" : "Férias";
        else if (atestado) situacao = "Atestado";
        else if (feriado.has(chave)) situacao = "Feriado";
        else if (!trabalha || hora?.folga === 1) situacao = "Folga";
        else if (emAndamento) situacao = "Hoje";
        else situacao = dono.banco_horas === "1" ? "Banco de Horas" : "Faltou";
      }
      // Saldo gravado pelo sistema antigo vale como está; sem ele, calcula aqui, já com a tolerância da CLT.
      const gravado = !emAndamento && hora?.saldo_dia ? saldoGravado(hora.saldo_dia) : null;
      const saldoSegundos = emAndamento
        ? 0
        : gravado
        ? (gravado.negativo ? -1 : 1) * (segundosRelogio(gravado.texto) ?? 0)
        : minutosCarga && dentroDaTolerancia(batidas, carga)
          ? 0
          : segundosFeitos - segundosCarga;
      const saldoDoDia = paraMinutos(saldoSegundos);
      const saldo = gravado ?? { texto: relogio(Math.abs(saldoDoDia)), negativo: saldoDoDia < 0 };
      return {
        data: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
        dia: nomes[indice],
        // Dia de uma contratação anterior (aparece só quando a empresa filtra a data).
        anterior: id !== colaborador.id_colaborador,
        situacao,
        entrada1: primeira?.entrada ?? "",
        saida1: primeira?.saida ?? "",
        entrada2: segundaBatida?.entrada ?? "",
        saida2: segundaBatida?.saida ?? "",
        // Todas as marcações do dia, na ordem (o espelho precisa mostrar todas: Portaria 671/2021).
        marcacoes: batidas.map((batida) => ({ entrada: batida.entrada ?? "", saida: batida.saida ?? "", ajustada: batida.ajustada })),
        noturno: segundosNoturnosDia ? relogio(paraMinutos(segundosNoturnosDia)) : "",
        total: relogio(minutosFeitos),
        carga: relogio(minutosCarga),
        saldo: saldo.texto,
        saldoNegativo: saldo.negativo && saldo.texto !== "00:00:00",
        banco: hora?.saldo_bh ?? "",
        bancoNegativo: Boolean(hora?.saldo_bh?.startsWith("-")),
        // Números para somar o período (dia em andamento ainda não entra).
        minutosFeitos: emAndamento ? 0 : minutosFeitos,
        minutosCarga: emAndamento ? 0 : minutosCarga,
        saldoMinutos: saldoDoDia,
        segundosFeitos: emAndamento ? 0 : segundosFeitos,
        segundosCarga: emAndamento ? 0 : segundosCarga,
        segundosNoturnos: emAndamento ? 0 : segundosNoturnosDia,
        saldoSegundos,
        // Entrada sem saída num dia que já acabou: marcação incompleta, o saldo do dia sai errado.
        incompleta: !emAndamento && batidas.some((batida) => batida.entrada && !batida.saida),
        // Algum horário do dia foi corrigido ou incluído por pedido aprovado (o espelho precisa identificar isso).
        ajustado: batidas.some((batida) => batida.ajustada),
        alertaAlmoco: alertaDoAlmoco(batidas),
        falta: situacao === "Faltou",
        atestado,
      };
    });
    return {
      nome: colaborador.nome ?? "",
      // Somas do período: o contrato atual e, se o filtro pegou dias de uma contratação anterior, ela à parte.
      periodo: resumoDoPeriodo(linhas.filter((linha) => !linha.anterior)),
      periodoAnterior: linhas.some((linha) => linha.anterior) ? resumoDoPeriodo(linhas.filter((linha) => linha.anterior)) : null,
      cargo: colaborador.cargo ?? "",
      bancoHoras: usaBanco,
      semRegistro: false,
      estagio,
      desligado: !colaborador.ativo,
      // Início do contrato atual: sem filtro de data o relatório começa nele.
      inicioContrato: inicioDe(colaborador),
      temAnterior: pessoa.rows.length > 1,
      // Para o Reativar abrir o cadastro já preenchido.
      cadastro: {
        nome: colaborador.nome ?? "", cpf: colaborador.cpf ?? "", email: colaborador.email ?? "", celular: colaborador.celular ?? "",
        cargo: colaborador.cargo ?? "", departamento: colaborador.departamento ?? "",
        modalidade: colaborador.modalidade === "1" || colaborador.modalidade === "2" ? colaborador.modalidade : "",
      },
      de: inicio,
      ate: fim,
      dias: linhas,
    };
  }

  async faturas(usuarioId: string, empresaId: string, situacao: string) {
    await this.garantir(usuarioId, empresaId);
    const novas = await this.db.query<{
      id: string; valor: string; vencimento: string; pagamento: string | null; link: string | null; situacao: string; competencia: string | null; asaas: string | null;
    }>(`
      select id::text, valor::text, vencimento::text, data_pagamento::text as pagamento,
             url_pagamento as link, situacao, descricao as competencia, asaas_payment_id as asaas
      from dna_work.cobranca_asaas
      where id_empresa = $1 and situacao <> 'cancelada'
    `, [empresaId]);
    const antigas = await this.db.query<{
      id: string; valor: string | null; vencimento: string | null; pagamento: string | null; link: string | null; status_fatura: string | null; mes: string | null; ano: string | null; asaas: string | null;
    }>(`
      select id_fatura::text as id, valor_final as valor, vencimento_fatura as vencimento, data_pg as pagamento,
             url_pg as link, status_fatura::text, mes::text, ano::text, id_asaas as asaas
      from dna_work.fatura
      where id_empresa = $1 and (tipo_fatura is null or tipo_fatura ilike 'padr%')
    `, [empresaId]);
    const jaVeioDoAsaas = new Set(novas.rows.map((item) => item.asaas).filter(Boolean));
    const lista = [
      ...novas.rows.map((item) => ({
        id: item.id,
        valor: item.valor,
        vencimento: item.vencimento,
        pagamento: item.pagamento,
        link: item.link,
        situacao: item.situacao === "paga" ? "Paga" : "Aberta",
        competencia: item.competencia,
      })),
      ...antigas.rows.filter((item) => !item.asaas || !jaVeioDoAsaas.has(item.asaas)).map((item) => ({
        id: item.id,
        valor: item.valor,
        vencimento: item.vencimento,
        pagamento: item.pagamento,
        link: item.link,
        situacao: item.status_fatura === "0" ? "Aberta" : "Paga",
        competencia: item.mes && item.ano ? `${item.mes}/${item.ano}` : null,
      })),
    ].filter((item) => situacao === "todas" || (situacao === "paga" ? item.situacao === "Paga" : item.situacao === "Aberta"));
    return lista.sort((a, b) => String(b.vencimento ?? "").localeCompare(String(a.vencimento ?? "")));
  }

  async empresa(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const atual = await this.db.query(`
      select coalesce(nome_fantasia, razao_social) as nome, razao_social, cnpj, email, telefone, cidade, uf, responsavel
      from dna_work.empresa where id_empresa = $1
    `, [empresaId]);
    const filiais = await this.db.query(`
      select coalesce(nome_fantasia, razao_social) as nome, cnpj, cidade
      from dna_work.empresa where matriz = $1 order by nome
    `, [empresaId]);
    return { ...(atual.rows[0] ?? {}), filiais: filiais.rows };
  }

  async salvarFilial(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = crypto.randomUUID();
    const nome = (body.nome ?? "").trim().slice(0, 255);
    if (nome.length < 2) throw new AppError(422, "NOME_CURTO", "Informe o nome da filial.");
    // Toda empresa do portal leva sede 10 e usa_asaas 1. A filial não tem endereço no formulário, então não vai para
    // public.empresa (sem latitude/longitude); o faturamento a agrupa pela matriz.
    await this.db.query(`
      insert into dna_work.empresa (
        id_empresa, nome_fantasia, razao_social, cnpj, email, cidade, matriz, tipo_empresa, status,
        sede, usa_asaas, usa_agente, razao_sem_acento, fantasia_sem_acento
      )
      values ($1,$2,$2,$3,$4,$5,$6,2,1,$7,$8,1,$9,$9)
    `, [id, nome, body.cnpj || null, body.email || null, body.cidade || null, empresaId, SEDE_DNA, USA_ASAAS, semAcento(nome)]);
    return { id };
  }

  async usuarios(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select u.id_u as id, u.nome_u as nome, u.email_u as email, u.telefone_u as telefone,
             case u.tipo::text
               when '1' then 'Administrador'
               when '2' then 'Gerente'
               when '3' then 'Comercial'
               when '4' then 'Operador'
               else coalesce(u.tipo::text, '')
             end as tipo,
             case when u.status = 1 then 'Ativo' else 'Inativo' end as situacao
      from dna_work.usuario_empresa u
      where u.empresa_u = $1
         or u.id_u = $2
         or exists (
           select 1 from dna_work.vinculo_empresa_usuario v
           where v.id_usuario = u.id_u and v.id_empresa = $1
         )
      order by u.nome_u
    `, [empresaId, usuarioId]);
    return rows.rows;
  }

  async salvarUsuario(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const nome = body.nome?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const senha = body.senha ?? "";
    const telefone = (body.telefone ?? "").trim().slice(0, 20);
    if (nome.length < 2) throw new AppError(422, "NOME_CURTO", "Informe o nome do usuário.");
    if (!email.includes("@")) throw new AppError(422, "EMAIL_INVALIDO", "Informe um e-mail válido.");
    if (senha.length < 6) throw new AppError(422, "SENHA_CURTA", "A senha precisa ter pelo menos 6 caracteres.");
    const id = crypto.randomUUID();
    const { hash } = await import("@node-rs/argon2");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        insert into dna_work.usuario_empresa
          (id_u, nome_u, email_u, senha_u, senha_hash, telefone_u, empresa_u, status, tipo, data_senha, atualiza_senha)
        values ($1,$2,$3,$4,$5,$6,$7,1,1,to_char(current_date,'YYYY/MM/DD'),0)
      `, [id, nome, email, null, await hash(senha), telefone, empresaId]); // senha_u (MD5 antigo) não é mais gravado
      await client.query(`insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa) values ($1,$2)`, [id, empresaId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(409, "USUARIO_DUPLICADO", "Já existe um usuário com estes dados.");
      }
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.db.query(`
        insert into dna_work.paginas_usuario_empresa (id_usuario, menu, sub1, sub2, paginas)
        select $1, menu, sub1, sub2, paginas from dna_work.paginas_usuario_empresa where id_usuario = $2 limit 1
      `, [id, usuarioId]);
    } catch {
      // O usuário já está na empresa. A cópia do menu não pode apagar o cadastro.
    }
    return { id, nome, email };
  }

  async talentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select id_candidato as id, nome, cpf, email, celular, bairro, cidade, estado, curso, modalidadecurso as ensino, datacadastro
      from dna_work.candidato
      where id_empresa = $1 order by nome limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async salvarTalento(usuarioId: string, empresaId: string, body: Record<string, string>) {
    await this.garantir(usuarioId, empresaId);
    const id = crypto.randomUUID();
    await this.db.query(`
      insert into dna_work.candidato (id_candidato, nome, cpf, email, celular, cidade, datacadastro, id_empresa)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [id, body.nome, body.cpf || null, body.email || null, body.celular || null, body.cidade || null, dataLegado(new Date().toISOString().slice(0, 10)), empresaId]);
    return { id };
  }

  async encaminhamentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select e.id_emcaminhamento as id, c.nome, v.cargo, e.data, e.data_entrevista, e.hora,
             case when e.compareceu = '1' then 'Compareceu' when e.reprovado = 'S' then 'Reprovado' else 'Encaminhado' end as situacao
      from dna_work.emcaminhamento e
      join dna_work.vaga v on v.id_vaga = e.id_vaga
      left join dna_work.candidato c on c.id_candidato = e.id_candidato
      where v.id_empresa = $1
      order by e.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async documentos(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select g.id_contratogerado as id, c.nome, g.nome_contrato as documentos, g.datainicio as inicio,
             case when g.devolvido::text in ('1', 'S', 's') then 'Devolvido' else 'Pendente' end as situacao
      from dna_work.contratos_gerados g
      left join dna_work.candidato c on c.id_candidato = g.id_candidato
      where g.id_empresa = $1
      order by g.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async seguro(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select g.id_contratogerado as id, c.nome, v.cargo, g.datainicio as inicio, g.datafim as fim, c.cpf
      from dna_work.contratos_gerados g
      join dna_work.candidato c on c.id_candidato = g.id_candidato
      left join dna_work.vaga v on v.id_vaga::text = g.vaga::text
      where g.id_empresa = $1
      order by g.datainicio desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async calendario(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select d.id, coalesce(nullif(btrim(d.title), ''), v.cargo) as nome, v.cargo, d.data, d.inicio as hora, d.termino, d.link
      from dna_work.entrevista_datas d
      join dna_work.vaga v on v.comparador::text = d.comparador::text
      where v.id_empresa = $1
      order by d.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async avaliacoes(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select a.id, c.nome, a.ciclo, a.area, a.data,
             case when a.completou_ciclo = '1' then 'Concluída' else 'Em aberto' end as situacao
      from dna_work.avaliacao_desepenho a
      join dna_work.colaborador col on col.id_colaborador = a.id_colaborador
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      where col.id_empresa = $1
      order by a.data desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async holerites(usuarioId: string, empresaId: string) {
    await this.garantir(usuarioId, empresaId);
    const rows = await this.db.query(`
      select h.id, h.nome_candidato as nome, h.cargo, h.copentencia as competencia, h.salario_brudo as bruto,
             coalesce(h.saldo_salario, h.total_vencimentos) as liquido
      from dna_work.holerite h
      join dna_work.vaga v on v.id_vaga = h.id_vaga
      where v.id_empresa = $1
      order by h.copentencia desc nulls last
      limit 200
    `, [empresaId]);
    return rows.rows;
  }

  async detalhe(usuarioId: string, empresaId: string, tipo: string, id: string) {
    await this.garantir(usuarioId, empresaId);
    const ficha = await this.montarDetalhe(empresaId, tipo, id);
    if (!ficha) throw new AppError(404, "REGISTRO_NAO_ENCONTRADO", "Registro não encontrado nesta empresa.");
    return ficha;
  }

  private async montarDetalhe(empresaId: string, tipo: string, id: string) {
    if (tipo === "colaborador") return this.detalheColaborador(empresaId, id);
    if (tipo === "contratado") return this.detalheContratado(empresaId, id);
    if (tipo === "vaga") return this.detalheVaga(empresaId, id);
    if (tipo === "talento") return this.detalheTalento(empresaId, id);
    if (tipo === "escala") return this.detalheEscala(empresaId, id);
    if (tipo === "carga") return this.detalheCarga(empresaId, id);
    if (tipo === "feriado") return this.detalheFeriado(empresaId, id);
    if (tipo === "usuario") return this.detalheUsuario(empresaId, id);
    if (tipo === "holerite") return this.detalheHolerite(empresaId, id);
    if (tipo === "fatura") return this.detalheFatura(empresaId, id);
    if (tipo === "encaminhamento") return this.detalheEncaminhamento(empresaId, id);
    if (tipo === "documento" || tipo === "seguro") return this.detalheContrato(empresaId, id, tipo);
    if (tipo === "calendario") return this.detalheCalendario(empresaId, id);
    if (tipo === "avaliacao") return this.detalheAvaliacao(empresaId, id);
    return null;
  }

  private async detalheColaborador(empresaId: string, id: string) {
    const pessoa = await this.db.query(`
      select c.nome, c.nomesocial, c.cpf, c.datanascimento, c.email, c.celular, c.telefonefixo,
             c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.cep,
             col.cargo, col.departamento, col.data_inicio, col.salario, col.banco_horas, col.id_colaborador,
             case when col.status_colaborador = 1 then 'Ativo' else 'Inativo' end as situacao,
             m.descricao as modalidade
      from dna_work.candidato c
      join dna_work.colaborador col on col.id_candidato = c.id_candidato and col.id_empresa = $2
      left join dna_work.modalidade_vaga m on m.id::text = col.tipo_vaga::text
      where c.id_candidato = $1
      order by case when col.status_colaborador = 1 then 0 else 1 end, col.data_cadastro desc nulls last
      limit 1
    `, [id, empresaId]);
    const linha = pessoa.rows[0] ?? await this.pessoaDaContratacao(empresaId, id);
    if (!linha) return null;
    const banco = linha.id_colaborador ? await this.saldoBanco(String(linha.id_colaborador)) : null;
    return ficha(linha.nome, linha.cargo, [
      ["Nome", linha.nome], ["Nome social", linha.nomesocial], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular], ["Telefone", linha.telefonefixo],
      ["Endereço", [linha.logradouro, linha.numero, linha.complemento].filter(Boolean).join(", ")],
      ["Bairro", linha.bairro], ["Cidade", linha.cidade], ["Estado", linha.estado], ["CEP", linha.cep],
      ["Cargo", linha.cargo], ["Departamento", linha.departamento], ["Modalidade", linha.modalidade],
      ["Início", linha.data_inicio], ["Situação", linha.situacao], ["Salário", dinheiro(linha.salario)],
      ["Banco de horas", linha.banco_horas === "1" || linha.banco_horas === 1 ? "Sim" : "Não"],
      ["Saldo do banco", banco?.saldo ?? null], ["Atualizado em", banco?.data ?? null],
    ]);
  }

  private async pessoaDaContratacao(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, c.nomesocial, c.cpf, c.datanascimento, c.email, c.celular, c.telefonefixo,
             c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.cep,
             v.cargo, col.departamento, cv.datainicio as data_inicio, null::text as salario, col.banco_horas, col.id_colaborador,
             case when cv.status = 2 or nullif(btrim(cv.data_demicao), '') is not null then 'Encerrado' else 'Ativo' end as situacao,
             m.descricao as modalidade
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.colaborador col on col.id_candidato = c.id_candidato
        and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
      left join dna_work.modalidade_vaga m on m.id::text = coalesce(v.tipo_vaga, col.tipo_vaga)::text
      where c.id_candidato = $1
        and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
      order by cv.data_contratacao desc nulls last
      limit 1
    `, [id, empresaId]);
    return rows.rows[0];
  }

  private async saldoBanco(idColaborador: string) {
    const rows = await this.db.query<{ saldo: string | null; data: string | null }>(`
      select saldo_bh as saldo, data
      from dna_work.banco_horas
      where id_colaborador = $1 and data ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'
      order by data desc
      limit 1
    `, [idColaborador]);
    return rows.rows[0];
  }

  private async detalheContratado(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, c.cpf, c.email, c.celular, c.datanascimento, v.cargo, m.descricao as modalidade,
             cv.datainicio, cv.datafim, cv.data_contratacao, cv.data_demicao, cv.status,
             col.departamento, col.salario, col.banco_horas, col.id_colaborador
      from dna_work.conratacaovaga cv
      join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
      left join dna_work.colaborador col on col.id_candidato = c.id_candidato
        and col.id_empresa = coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa)
      where cv.id_contratacao::text = $1
        and coalesce(nullif(btrim(cv.id_empresa), ''), v.id_empresa) = $2
      limit 1
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const banco = linha.id_colaborador ? await this.saldoBanco(String(linha.id_colaborador)) : null;
    return ficha(linha.nome, linha.cargo, [
      ["Nome", linha.nome], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular],
      ["Cargo", linha.cargo], ["Departamento", linha.departamento], ["Modalidade", linha.modalidade],
      ["Contratação", linha.data_contratacao], ["Início", linha.datainicio], ["Fim", linha.datafim],
      ["Demissão", linha.data_demicao],
      ["Situação", linha.data_demicao || Number(linha.status) === 2 ? "Encerrado" : "Ativo"],
      ["Salário", dinheiro(linha.salario)],
      ["Banco de horas", linha.banco_horas === "1" || linha.banco_horas === 1 ? "Sim" : "Não"],
      ["Saldo do banco", banco?.saldo ?? null], ["Atualizado em", banco?.data ?? null],
    ]);
  }

  private async detalheVaga(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select coalesce(nullif(btrim(v.codigo::text), ''), v.comparador) as codigo, v.cargo, v.tipo_vaga,
             m.descricao as modalidade, v.salario,
             (select sum(coalesce(irma.quantidade_posicoes, 1))::int from dna_work.vaga irma
               where irma.id_empresa = v.id_empresa and irma.status = v.status
                 and coalesce(nullif(btrim(irma.comparador), ''), irma.id_vaga) = coalesce(nullif(btrim(v.comparador), ''), v.id_vaga)) as quantidade_posicoes,
             coalesce(nullif(btrim(v.cidade), ''), e.cidade) as cidade, v.periodo, v.dataabertura, v.dataencerramento, v.escolaridade::text as escolaridade,
             v.experiencia, v.sexo, v.idade, v.idadeate,
             v.atribuicaoes, coalesce(nullif(btrim(v.beneficios_texto), ''), v.beneficios) as beneficios, v.requisitos_desejaveis, v.carga_horaria, v.jornada, v.texto_carga, v.obs, v.responsavel, v.remoto, v.status
      from dna_work.vaga v
      join dna_work.empresa e on e.id_empresa = v.id_empresa
      left join dna_work.modalidade_vaga m on m.id::text = v.tipo_vaga::text
      where v.id_vaga = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const estagio = Number(linha.tipo_vaga) === 1;
    const medio = linha.escolaridade === ESCOLARIDADE_ENSINO_MEDIO;
    const carga = linha.carga_horaria && /^\d+$/.test(String(linha.carga_horaria)) ? `${linha.carga_horaria} horas por semana` : linha.carga_horaria;
    const idade = linha.idade && linha.idadeate ? `${linha.idade} a ${linha.idadeate} anos` : linha.idade ? `A partir de ${linha.idade} anos` : null;
    return ficha(linha.cargo, linha.modalidade, [
      ["Código", linha.codigo], ["Cargo", linha.cargo], ["Modalidade", linha.modalidade],
      ["Posições", linha.quantidade_posicoes], [estagio ? "Bolsa-auxílio" : "Salário", dinheiro(linha.salario)], ["Cidade", linha.cidade],
      ["Período", linha.periodo], ["Horário", linha.jornada || linha.texto_carga], ["Carga horária", carga],
      ["Aceita ensino médio", estagio ? (medio ? "Sim" : "Não") : null],
      ["Sexo", linha.sexo === "M" ? "Masculino" : linha.sexo === "F" ? "Feminino" : linha.sexo === "I" ? "Indiferente" : null],
      ["Idade", idade],
      ["Situação", situacaoVaga(linha.status)],
      ["Abertura", linha.dataabertura], ["Encerramento", linha.dataencerramento],
      ["Experiência", linha.experiencia],
      ["Atividades", linha.atribuicaoes], ["Requisitos", linha.requisitos_desejaveis], ["Benefícios", linha.beneficios],
      ["Remoto", linha.remoto === 1 || linha.remoto === "1" ? "Sim" : linha.remoto ? "Não" : null],
      ["Responsável", linha.responsavel], ["Observação", linha.obs],
    ]);
  }

  private async detalheTalento(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, nomesocial, cpf, datanascimento, email, celular, telefonefixo,
             logradouro, numero, complemento, bairro, cidade, estado, cep,
             modalidadecurso, curso, nome_escola, datacadastro, objetivo, pretencao_salarial
      from dna_work.candidato
      where id_candidato = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.curso, [
      ["Nome", linha.nome], ["Nome social", linha.nomesocial], ["CPF", linha.cpf], ["Nascimento", linha.datanascimento],
      ["E-mail", linha.email], ["Celular", linha.celular], ["Telefone", linha.telefonefixo],
      ["Endereço", [linha.logradouro, linha.numero, linha.complemento].filter(Boolean).join(", ")],
      ["Bairro", linha.bairro], ["Cidade", linha.cidade], ["Estado", linha.estado], ["CEP", linha.cep],
      ["Ensino", linha.modalidadecurso], ["Curso", linha.curso], ["Escola", linha.nome_escola],
      ["Cadastro", linha.datacadastro], ["Objetivo", linha.objetivo], ["Pretensão", dinheiro(linha.pretencao_salarial)],
    ]);
  }

  private async detalheEscala(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome,
             case when segunda_feira::text = '1' then 'Trabalha' else 'Folga' end as segunda,
             case when terca_feira::text = '1' then 'Trabalha' else 'Folga' end as terca,
             case when quarta_feira::text = '1' then 'Trabalha' else 'Folga' end as quarta,
             case when quinta_feira::text = '1' then 'Trabalha' else 'Folga' end as quinta,
             case when sexta_feira::text = '1' then 'Trabalha' else 'Folga' end as sexta,
             case when sabado::text = '1' then 'Trabalha' else 'Folga' end as sabado,
             case when domingo::text = '1' then 'Trabalha' else 'Folga' end as domingo
      from dna_work.ponto_turno_base
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, "Escala", [
      ["Nome", linha.nome], ["Segunda", linha.segunda], ["Terça", linha.terca], ["Quarta", linha.quarta],
      ["Quinta", linha.quinta], ["Sexta", linha.sexta], ["Sábado", linha.sabado], ["Domingo", linha.domingo],
    ]);
  }

  private async detalheCarga(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, tipo, entrada, saida_refeicao, retorno_refeicao, saida, tolerancia, pausa, refeicao_livre, refeicao_minutos
      from dna_work.ponto_carga_base
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.tipo, [
      ["Nome", linha.nome], ["Tipo", linha.tipo], ["Entrada", linha.entrada],
      ...(Number(linha.refeicao_livre) === 1
        ? [["Refeição", `Livre, ${duracao(Number(linha.refeicao_minutos))}`] as [string, unknown]]
        : [["Saída refeição", linha.saida_refeicao], ["Retorno refeição", linha.retorno_refeicao]] as Array<[string, unknown]>),
      ["Saída", linha.saida], ["Tolerância", linha.tolerancia],
      ["Pausa", Number(linha.pausa) === 1 ? "Sim" : "Não"],
    ]);
  }

  private async detalheFeriado(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select nome, data from dna_work.feriados where id_feriado::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.data, [["Nome", linha.nome], ["Data", linha.data]]);
  }

  private async detalheUsuario(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select u.nome_u as nome, u.email_u as email, u.telefone_u as telefone,
             case u.tipo::text when '1' then 'Administrador' when '2' then 'Gerente' when '3' then 'Comercial' when '4' then 'Operador' else u.tipo::text end as tipo,
             case when u.status = 1 then 'Ativo' else 'Inativo' end as situacao
      from dna_work.usuario_empresa u
      where u.id_u = $1
        and (u.empresa_u = $2 or exists (select 1 from dna_work.vinculo_empresa_usuario v where v.id_usuario = u.id_u and v.id_empresa = $2))
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.tipo, [
      ["Nome", linha.nome], ["E-mail", linha.email], ["Telefone", linha.telefone], ["Tipo", linha.tipo], ["Situação", linha.situacao],
    ]);
  }

  private async detalheHolerite(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select h.nome_candidato, h.cpf, h.cargo, h.copentencia, h.data_adimicao, h.diastrabalhados,
             h.salario_brudo, h.total_vencimentos, h.desconto_total, h.saldo_salario,
             h.valor_inss, h.valor_irrf, h.fgts_valor, h.faltas_valor, h.hora_extra_valor, h.adiamtamento_valor,
             h.banco, h.ag, h.cc, h.pix_tipo, h.pix_chave
      from dna_work.holerite h
      join dna_work.vaga v on v.id_vaga = h.id_vaga
      where h.id::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome_candidato, linha.copentencia, [
      ["Nome", linha.nome_candidato], ["CPF", linha.cpf], ["Cargo", linha.cargo],
      ["Competência", linha.copentencia], ["Admissão", linha.data_adimicao], ["Dias trabalhados", linha.diastrabalhados],
      ["Salário bruto", dinheiro(linha.salario_brudo)], ["Vencimentos", dinheiro(linha.total_vencimentos)],
      ["Descontos", dinheiro(linha.desconto_total)], ["Líquido", dinheiro(linha.saldo_salario)],
      ["INSS", dinheiro(linha.valor_inss)], ["IRRF", dinheiro(linha.valor_irrf)], ["FGTS", dinheiro(linha.fgts_valor)],
      ["Faltas", dinheiro(linha.faltas_valor)], ["Hora extra", dinheiro(linha.hora_extra_valor)],
      ["Adiantamento", dinheiro(linha.adiamtamento_valor)],
      ["Banco", linha.banco], ["Agência", linha.ag], ["Conta", linha.cc], ["Pix", [linha.pix_tipo, linha.pix_chave].filter(Boolean).join(" ")],
    ]);
  }

  private async detalheFatura(empresaId: string, id: string) {
    const nova = await this.db.query(`
      select descricao, vencimento::text, valor::text, situacao, data_pagamento::text as pagamento, url_pagamento
      from dna_work.cobranca_asaas
      where id::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    if (nova.rows[0]) {
      const linha = nova.rows[0];
      return ficha(linha.descricao || "Fatura", linha.situacao, [
        ["Competência", linha.descricao], ["Vencimento", linha.vencimento], ["Valor", dinheiro(linha.valor)],
        ["Situação", linha.situacao === "paga" ? "Paga" : "Aberta"], ["Pagamento", linha.pagamento], ["Link", linha.url_pagamento],
      ]);
    }
    const antiga = await this.db.query(`
      select mes, ano, vencimento_fatura, valor_inicial, desconto, acressimo, valor_final, status_fatura, data_pg, forma_pg, url_pg
      from dna_work.fatura
      where id_fatura::text = $1 and id_empresa = $2
    `, [id, empresaId]);
    const linha = antiga.rows[0];
    if (!linha) return null;
    return ficha(linha.mes && linha.ano ? `${linha.mes}/${linha.ano}` : "Fatura", linha.status_fatura === "0" ? "Aberta" : "Paga", [
      ["Competência", linha.mes && linha.ano ? `${linha.mes}/${linha.ano}` : null],
      ["Vencimento", linha.vencimento_fatura], ["Valor inicial", dinheiro(linha.valor_inicial)],
      ["Desconto", dinheiro(linha.desconto)], ["Acréscimo", dinheiro(linha.acressimo)], ["Valor", dinheiro(linha.valor_final)],
      ["Situação", linha.status_fatura === "0" ? "Aberta" : "Paga"], ["Pagamento", linha.data_pg],
      ["Forma", linha.forma_pg], ["Link", linha.url_pg],
    ]);
  }

  private async detalheEncaminhamento(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, v.cargo, e.data, e.data_entrevista, e.hora, e.endereco, e.compareceu, e.reprovado, e.motivo, e.feed
      from dna_work.emcaminhamento e
      join dna_work.vaga v on v.id_vaga = e.id_vaga
      left join dna_work.candidato c on c.id_candidato = e.id_candidato
      where e.id_emcaminhamento::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const situacao = linha.compareceu === "1" ? "Compareceu" : linha.reprovado === "S" ? "Reprovado" : "Encaminhado";
    return ficha(linha.nome, linha.cargo, [
      ["Candidato", linha.nome], ["Vaga", linha.cargo], ["Convocação", linha.data],
      ["Entrevista", linha.data_entrevista], ["Hora", linha.hora], ["Endereço", linha.endereco],
      ["Situação", situacao], ["Motivo", linha.motivo], ["Retorno", linha.feed],
    ]);
  }

  private async detalheContrato(empresaId: string, id: string, tipo: string) {
    const rows = await this.db.query(`
      select c.nome, c.cpf, v.cargo, g.nome_contrato, g.datainicio, g.datafim, g.datadevolucao, g.devolvido, g.data
      from dna_work.contratos_gerados g
      left join dna_work.candidato c on c.id_candidato = g.id_candidato
      left join dna_work.vaga v on v.id_vaga::text = g.vaga::text
      where g.id_contratogerado::text = $1 and g.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    const campos: Array<[string, unknown]> = [
      ["Nome", linha.nome], ["CPF", linha.cpf], ["Cargo", linha.cargo], ["Contrato", linha.nome_contrato],
      ["Início", linha.datainicio], ["Fim", linha.datafim], ["Gerado em", linha.data],
    ];
    if (tipo === "documento") {
      campos.push(["Devolução", linha.datadevolucao], ["Situação", ["1", "S", "s"].includes(String(linha.devolvido)) ? "Devolvido" : "Pendente"]);
    }
    return ficha(linha.nome, tipo === "seguro" ? "Seguro de vida" : linha.nome_contrato, campos);
  }

  private async detalheCalendario(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select coalesce(nullif(btrim(d.title), ''), v.cargo) as nome, v.cargo, d.data, d.inicio, d.termino, d.endereco, d.link, d.tipo
      from dna_work.entrevista_datas d
      join dna_work.vaga v on v.comparador::text = d.comparador::text
      where d.id::text = $1 and v.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.cargo, [
      ["Compromisso", linha.nome], ["Vaga", linha.cargo], ["Data", linha.data], ["Início", linha.inicio],
      ["Término", linha.termino], ["Endereço", linha.endereco], ["Link", linha.link], ["Tipo", linha.tipo],
    ]);
  }

  private async detalheAvaliacao(empresaId: string, id: string) {
    const rows = await this.db.query(`
      select c.nome, a.ciclo, a.area, a.sub_area, a.dimensao, a.nivel, a.data,
             a.respondido_empresa, a.respondido_colaborador, a.completou_ciclo
      from dna_work.avaliacao_desepenho a
      join dna_work.colaborador col on col.id_colaborador = a.id_colaborador
      left join dna_work.candidato c on c.id_candidato = col.id_candidato
      where a.id::text = $1 and col.id_empresa = $2
    `, [id, empresaId]);
    const linha = rows.rows[0];
    if (!linha) return null;
    return ficha(linha.nome, linha.ciclo, [
      ["Colaborador", linha.nome], ["Ciclo", linha.ciclo], ["Área", linha.area], ["Subárea", linha.sub_area],
      ["Dimensão", linha.dimensao], ["Nível", linha.nivel], ["Data", linha.data],
      ["Resposta da empresa", linha.respondido_empresa], ["Resposta do colaborador", linha.respondido_colaborador],
      ["Situação", linha.completou_ciclo === "1" ? "Concluída" : "Em aberto"],
    ]);
  }

  private async garantir(usuarioId: string, empresaId: string) {
    const acesso = await this.db.query(`
      select 1 from dna_work.usuario_empresa where id_u = $1 and empresa_u = $2 and status = 1
      union
      select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1 and id_empresa = $2
    `, [usuarioId, empresaId]);
    if (!acesso.rowCount) throw new AppError(403, "EMPRESA_NEGADA", "Esta empresa não está vinculada ao usuário.");
  }
}
