import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../lib/api";

type Modalidade = "clt" | "estagio";
type NivelEnsino = "" | "medio" | "superior" | "ambos";

const NIVEIS: Array<[Exclude<NivelEnsino, "">, string, string]> = [
  ["medio", "Ensino médio", "Estudantes do ensino médio"],
  ["superior", "Ensino superior", "Estudantes de faculdade"],
  ["ambos", "Os dois", "Médio ou superior"],
];
const ROTULO_NIVEL: Record<Exclude<NivelEnsino, "">, string> = { medio: "Ensino médio", superior: "Ensino superior", ambos: "Ensino médio ou superior" };
type Clausula = { titulo: string; texto: string };
type Termos = {
  versao: string;
  titulo: string;
  aviso: string;
  clausulas: Clausula[];
  modalidades: Record<Modalidade, { titulo: string; itens: string[] }>;
};
type Consulta = {
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
type Conclusao = {
  email: string;
  senha: string;
  comprovante: string;
  aceitoEm: string;
  versao: string;
};

type Formulario = {
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
  modalidade: Modalidade;
  nivelEnsino: NivelEnsino;
  vaga: string;
  quantidade: string;
  salario: string;
  beneficios: string;
  jornada: string;
  endereco: string;
  cidadevaga: string;
  ufvaga: string;
  atividades: string;
  termos: boolean;
  poderes: boolean;
  website: string;
};

const VAZIO: Formulario = {
  cnpj: "", razao: "", fantasia: "", telefone: "", nome: "", cargo: "", email: "", telefoneResponsavel: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  modalidade: "clt", nivelEnsino: "", vaga: "", quantidade: "1", salario: "", beneficios: "", jornada: "", endereco: "",
  cidadevaga: "", ufvaga: "", atividades: "", termos: false, poderes: false, website: "",
};

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const ETAPAS = ["Sua empresa", "Primeira vaga", "Aceite dos termos"];

function digitos(valor: string, maximo: number) {
  return valor.replace(/\D/g, "").slice(0, maximo);
}

function mascaraCnpj(valor: string) {
  return digitos(valor, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function mascaraTelefone(valor: string) {
  const d = digitos(valor, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function mascaraCep(valor: string) {
  return digitos(valor, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

function texto(valor: string, maximo: number) {
  return valor.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maximo);
}

function cnpjValido(valor: string) {
  const d = digitos(valor, 14);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const digito = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((total, numero, indice) => total + Number(numero) * pesos[indice], 0);
    return soma % 11 < 2 ? 0 : 11 - (soma % 11);
  };
  const primeiro = digito(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(d.slice(0, 12) + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${primeiro}${segundo}`);
}

function emailValido(valor: string) {
  if (valor.length < 6 || valor.length > 255 || (valor.match(/@/g) ?? []).length !== 1) return false;
  const [local, dominio] = valor.split("@");
  if (!local || !dominio || local.startsWith(".") || local.endsWith(".") || dominio.startsWith(".") || dominio.endsWith(".")) return false;
  return /^[A-Za-z0-9._%+-]+$/.test(local) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(dominio);
}

function telefoneValido(valor: string) {
  const total = digitos(valor, 11).length;
  return total === 10 || total === 11;
}

function salarioValido(valor: string) {
  return /^(\d{1,3}(\.\d{3})+|\d{1,7})(,\d{2})?$/.test(valor);
}

function errosDoFormulario(form: Formulario, etapa: number): Record<string, string> {
  const erros: Record<string, string> = {};
  const por = (chave: string, mensagem: string) => {
    erros[chave] = mensagem;
  };
  if (etapa === 1 || etapa === 3) {
    if (!cnpjValido(form.cnpj)) por("cnpj", "Informe um CNPJ válido com 14 números.");
    if (texto(form.razao, 255).trim().length < 2) por("razao", "Informe a razão social.");
    if (!telefoneValido(form.telefone)) por("telefone", "Informe o telefone comercial com DDD e 10 ou 11 números.");
    if (texto(form.nome, 150).trim().length < 5 || !form.nome.trim().includes(" ")) por("nome", "Informe o nome e o sobrenome do responsável.");
    if (texto(form.cargo, 80).trim().length < 2) por("cargo", "Informe o cargo do responsável.");
    if (!form.email.includes("@")) por("email", "O e-mail precisa ter @.");
    else if (!emailValido(form.email.trim().toLowerCase())) por("email", "Informe um e-mail válido, como nome@empresa.com.br.");
    if (!telefoneValido(form.telefoneResponsavel)) por("telefoneResponsavel", "Informe o telefone do responsável com DDD e 10 ou 11 números.");
    if (digitos(form.cep, 8).length !== 8) por("cep", "Informe o CEP com 8 números.");
    if (texto(form.logradouro, 255).trim().length < 2) por("logradouro", "Informe o logradouro.");
    if (!/^[0-9A-Za-z/-]{1,10}$/.test(form.numero.trim())) por("numero", "Informe o número com até 10 caracteres, ou S/N.");
    if (texto(form.bairro, 50).trim().length < 2) por("bairro", "Informe o bairro com até 50 caracteres.");
    if (texto(form.cidade, 100).trim().length < 2) por("cidade", "Informe a cidade.");
    if (!UFS.includes(form.uf.toUpperCase())) por("uf", "Informe a UF com 2 letras.");
  }
  if (etapa === 2 || etapa === 3) {
    if (form.modalidade !== "clt" && form.modalidade !== "estagio") por("modalidade", "Escolha CLT ou estágio.");
    if (form.modalidade === "estagio" && !form.nivelEnsino) por("nivelEnsino", "Escolha se o estágio é para ensino médio, superior ou os dois.");
    if (texto(form.vaga, 180).trim().length < 2) por("vaga", "Informe o cargo da vaga.");
    if (!/^\d{1,3}$/.test(form.quantidade) || Number(form.quantidade) < 1 || Number(form.quantidade) > 999) por("quantidade", "Informe a quantidade de 1 a 999.");
    if (!salarioValido(form.salario.trim())) por("salario", "Informe o salário ou a bolsa apenas com números, como 1.850,00.");
    if (texto(form.jornada, 255).trim().length < 3) por("jornada", "Descreva a jornada em até 255 caracteres.");
    if (texto(form.endereco, 255).trim().length < 3) por("endereco", "Informe o endereço de trabalho com até 255 caracteres.");
    if (texto(form.cidadevaga, 100).trim().length < 2) por("cidadevaga", "Informe a cidade da vaga.");
    if (!UFS.includes(form.ufvaga.toUpperCase())) por("ufvaga", "Informe a UF da vaga com 2 letras.");
    if (texto(form.atividades, 2000).trim().length < 10) por("atividades", "Descreva as atividades em pelo menos 10 caracteres.");
  }
  if (etapa === 3) {
    if (!form.termos) por("termos", "Leia e aceite os termos para concluir.");
    if (!form.poderes) por("poderes", "Confirme que você pode representar a empresa.");
  }
  return erros;
}

function prontidao(form: Formulario, etapa: number) {
  const chaves = etapa === 1
    ? ["cnpj", "razao", "telefone", "nome", "cargo", "email", "telefoneResponsavel", "cep", "logradouro", "numero", "bairro", "cidade", "uf"]
    : etapa === 2
      ? [...(form.modalidade === "estagio" ? ["nivelEnsino"] : []), "vaga", "quantidade", "salario", "jornada", "endereco", "cidadevaga", "ufvaga", "atividades"]
      : ["termos", "poderes"];
  const erros = errosDoFormulario(form, etapa);
  const prontos = chaves.filter((chave) => !erros[chave]).length;
  return { prontos, total: chaves.length, percentual: Math.round((prontos / chaves.length) * 100) };
}

export function CadastroPage() {
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [etapa, setEtapa] = useState(1);
  const [saindo, setSaindo] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState("");
  const [existe, setExiste] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [termos, setTermos] = useState<Termos | null>(null);
  const [modal, setModal] = useState(false);
  const [mesmoEndereco, setMesmoEndereco] = useState(false);
  const [conclusao, setConclusao] = useState<Conclusao | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    void api<Termos>("/api/v1/publico/cadastro/termos").then((resposta) => setTermos(resposta.data)).catch(() => setAviso("Não foi possível carregar os termos. Recarregue a página."));
  }, []);

  useEffect(() => {
    if (!modal) return;
    const fechar = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(false);
    };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [modal]);

  const atual = prontidao(form, Math.min(etapa, 3));
  const geral = etapa === 4 ? 100 : Math.round(((etapa - 1) + atual.percentual / 100) / 3 * 100);
  const condicoes = termos?.modalidades[form.modalidade];

  const enderecoEmpresa = useMemo(() => {
    const base = [form.logradouro.trim(), form.numero.trim()].filter(Boolean).join(", ");
    return [base, form.bairro.trim()].filter(Boolean).join(" - ");
  }, [form.logradouro, form.numero, form.bairro]);

  function definir<K extends keyof Formulario>(chave: K, valor: Formulario[K]) {
    setForm((atual) => ({ ...atual, [chave]: valor }));
    setErros((atual) => {
      if (!atual[chave as string]) return atual;
      const proximo = { ...atual };
      delete proximo[chave as string];
      return proximo;
    });
  }

  function ir(proxima: number) {
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzido) {
      setEtapa(proxima);
      return;
    }
    setSaindo(true);
    window.setTimeout(() => {
      setEtapa(proxima);
      setSaindo(false);
    }, 165);
  }

  async function consultar() {
    setAviso("");
    if (!cnpjValido(form.cnpj)) {
      setErros((atual) => ({ ...atual, cnpj: "Informe um CNPJ válido com 14 números." }));
      return;
    }
    setConsultando(true);
    try {
      const resposta = await api<Consulta>(`/api/v1/publico/cadastro/cnpj/${digitos(form.cnpj, 14)}`);
      const dados = resposta.data;
      setExiste(dados.existe);
      setForm((atual) => ({
        ...atual,
        cnpj: dados.cnpj || atual.cnpj,
        razao: dados.razao || atual.razao,
        fantasia: dados.fantasia || atual.fantasia,
        telefone: dados.telefone ? mascaraTelefone(dados.telefone) : atual.telefone,
        cep: dados.cep || atual.cep,
        logradouro: dados.logradouro || atual.logradouro,
        numero: dados.numero || atual.numero,
        complemento: dados.complemento || atual.complemento,
        bairro: dados.bairro || atual.bairro,
        cidade: dados.cidade || atual.cidade,
        uf: dados.uf || atual.uf,
      }));
      if (dados.existe) setAviso("Este CNPJ já está cadastrado. Use o acesso do portal ou fale com a DNA Work.");
      else if (!dados.consulta) setAviso("Não foi possível consultar este CNPJ agora. Preencha os dados manualmente.");
    } catch (error) {
      setAviso(error instanceof ApiError ? error.message : "Não foi possível consultar o CNPJ.");
    } finally {
      setConsultando(false);
    }
  }

  function usarEnderecoEmpresa(marcado: boolean) {
    setMesmoEndereco(marcado);
    if (!marcado) return;
    definir("endereco", enderecoEmpresa.slice(0, 255));
    definir("cidadevaga", form.cidade);
    definir("ufvaga", form.uf);
  }

  function continuar(event: FormEvent) {
    event.preventDefault();
    setAviso("");
    if (etapa === 4) return;
    const encontrados = errosDoFormulario(form, etapa);
    setErros(encontrados);
    if (Object.keys(encontrados).length) {
      setAviso("Revise os campos destacados antes de continuar.");
      return;
    }
    if (etapa === 1 && existe) {
      setAviso("Este CNPJ já está cadastrado. Use o acesso do portal ou fale com a DNA Work.");
      return;
    }
    if (etapa === 3) {
      void concluir();
      return;
    }
    ir(etapa + 1);
  }

  async function concluir() {
    if (!termos) {
      setAviso("Os termos ainda não carregaram. Recarregue a página.");
      return;
    }
    setEnviando(true);
    try {
      const resposta = await api<Conclusao>("/api/v1/publico/cadastro", {
        method: "POST",
        body: JSON.stringify({
          website: form.website,
          empresa: {
            cnpj: form.cnpj, razao: form.razao, fantasia: form.fantasia, telefone: form.telefone,
            nome: form.nome, cargo: form.cargo, email: form.email, telefoneResponsavel: form.telefoneResponsavel,
            cep: form.cep, logradouro: form.logradouro, numero: form.numero, complemento: form.complemento,
            bairro: form.bairro, cidade: form.cidade, uf: form.uf,
          },
          vaga: {
            modalidade: form.modalidade, ...(form.modalidade === "estagio" ? { nivelEnsino: form.nivelEnsino } : {}), cargo: form.vaga, quantidade: Number(form.quantidade), salario: form.salario,
            beneficios: form.beneficios, jornada: form.jornada, endereco: form.endereco, cidade: form.cidadevaga,
            uf: form.ufvaga, atividades: form.atividades,
          },
          aceite: { versao: termos.versao, termos: form.termos, poderes: form.poderes },
        }),
      });
      setConclusao(resposta.data);
      ir(4);
    } catch (error) {
      if (error instanceof ApiError) {
        setAviso(error.message);
        if (error.campos) {
          const locais: Record<string, string> = {};
          for (const [chave, mensagem] of Object.entries(error.campos)) locais[chave.split(".").at(-1) ?? chave] = mensagem;
          setErros(locais);
        }
        if (error.code === "EMPRESA_EXISTENTE") setExiste(true);
      } else {
        setAviso("Não foi possível concluir o cadastro.");
      }
    } finally {
      setEnviando(false);
    }
  }

  async function copiarSenha() {
    if (!conclusao) return;
    try {
      await navigator.clipboard.writeText(conclusao.senha);
      setCopiado(true);
    } catch {
      setAviso("Não foi possível copiar a senha. Anote os caracteres exibidos.");
    }
  }

  return (
    <div className="min-h-dvh bg-[#f6f4f7] text-[#24182d]">
      <header className="border-b border-[#eee9f2] bg-white">
        <div className="mx-auto flex h-[76px] max-w-6xl items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <img src="/logo-mono.png" alt="DNA Work" className="h-10 w-16 object-contain" />
            <span className="hidden h-7 w-px bg-[#e9e2ee] sm:block" />
            <span className="hidden sm:block">
              <strong className="block text-sm">Portal de empresas</strong>
              <small className="text-[11px] text-[#8c7d95]">Cadastro de nova empresa</small>
            </span>
          </div>
          <Link to="/login" className="rounded-[10px] border border-[#e9e2ee] px-4 py-2 text-sm font-bold text-[#6a4b84]">Entrar</Link>
        </div>
      </header>
      <main className="cadastro-enter mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-12">
        <div>
          <p className="inline-flex rounded-full border border-[#e7dff0] bg-white px-3 py-1 text-xs font-bold tracking-wide text-[#6a4b84]">Recrutamento inteligente para sua empresa</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Sua próxima contratação<br /><span className="text-[#6a4b84]">começa aqui.</span></h1>
              <p className="mt-2 max-w-xl text-sm text-[#6f6578]">Cadastre sua empresa, conte o que precisa e receba o acesso ao portal para acompanhar a primeira vaga.</p>
            </div>
            <p className="text-sm text-[#86798e]">Cadastro simples, em três etapas</p>
          </div>

          <ol className="mt-6 grid gap-2 sm:grid-cols-3">
            {ETAPAS.map((nome, indice) => {
              const numero = indice + 1;
              const feita = etapa > numero || (etapa === numero && atual.percentual === 100 && etapa < 4);
              const ativa = etapa === numero;
              const largura = etapa > numero ? 100 : ativa ? atual.percentual : 0;
              return (
                <li key={nome} className={`relative overflow-hidden rounded-2xl border bg-white px-3 py-3 ${ativa ? "border-[#6a4b84]" : "border-[#eee9f2]"}`}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-full border text-sm font-bold ${feita || ativa ? "cadastro-pop border-[#6a4b84] bg-[#6a4b84] text-white" : "border-[#e7dff0] text-[#8c7d95]"}`}>{feita ? "✓" : numero}</span>
                    <span>
                      <small className="block text-[10px] font-bold tracking-wide text-[#8c7d95]">ETAPA 0{numero}</small>
                      <strong className="text-sm">{nome}</strong>
                    </span>
                  </div>
                  <span className="absolute inset-x-3 bottom-2 h-[3px] overflow-hidden rounded-full bg-[#eae2ef]"><i className="cadastro-meter block h-full rounded-full bg-[#795799]" style={{ width: `${largura}%` }} /></span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex items-center justify-between text-sm text-[#6f6578]">
            <span aria-live="polite">{etapa === 4 ? "Todas as etapas concluídas" : `Etapa ${etapa} de 3 · ${ETAPAS[etapa - 1]}`}</span>
            <span className={atual.percentual === 100 ? "font-bold text-[#2f7d4a]" : ""}>{etapa === 4 ? "100%" : atual.percentual === 100 ? "Pronto para continuar" : `${atual.prontos} de ${atual.total} campos`}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eae2ef]" role="progressbar" aria-label="Progresso geral do cadastro" aria-valuemin={0} aria-valuemax={100} aria-valuenow={geral}>
            <div className="cadastro-meter h-full rounded-full bg-[#6a4b84]" style={{ width: `${geral}%` }} />
          </div>

          <form className={`mt-4 rounded-3xl border border-[#eee9f2] bg-white p-4 shadow-sm sm:p-6 ${saindo ? "cadastro-stage-out" : "cadastro-stage-in"}`} onSubmit={continuar} noValidate>
            <input className="absolute -left-[9999px] h-0 w-0" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(event) => definir("website", event.target.value)} />
            {etapa === 1 ? (
              <section>
                <Cabeca titulo="Vamos conhecer sua empresa" texto="Comece com os dados da empresa responsável pela contratação." />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Campo label="CNPJ" obrigatorio erro={erros.cnpj} className="sm:col-span-2">
                    <div className="flex gap-2">
                      <input className={entrada(erros.cnpj)} inputMode="numeric" autoComplete="off" maxLength={18} placeholder="00.000.000/0000-00" aria-label="CNPJ" value={form.cnpj} onChange={(event) => { setExiste(false); definir("cnpj", mascaraCnpj(event.target.value)); }} />
                      <button type="button" className="h-11 shrink-0 rounded-xl bg-[#f3e8f5] px-3 text-sm font-bold text-[#6a4b84] disabled:opacity-50" disabled={consultando} onClick={() => void consultar()}>{consultando ? "Consultando…" : "Consultar"}</button>
                    </div>
                  </Campo>
                  <Campo label="Razão social" obrigatorio erro={erros.razao}><input className={entrada(erros.razao)} maxLength={255} placeholder="Nome jurídico da empresa" aria-label="Razão social" value={form.razao} onChange={(event) => definir("razao", texto(event.target.value, 255))} /></Campo>
                  <Campo label="Nome fantasia" erro={erros.fantasia}><input className={entrada()} maxLength={255} placeholder="Como sua empresa é conhecida" aria-label="Nome fantasia" value={form.fantasia} onChange={(event) => definir("fantasia", texto(event.target.value, 255))} /></Campo>
                  <Campo label="Telefone comercial" obrigatorio erro={erros.telefone}><input className={entrada(erros.telefone)} inputMode="tel" autoComplete="tel" maxLength={15} placeholder="(11) 99999-9999" aria-label="Telefone comercial" value={form.telefone} onChange={(event) => definir("telefone", mascaraTelefone(event.target.value))} /></Campo>
                  <Campo label="CEP" obrigatorio erro={erros.cep}><input className={entrada(erros.cep)} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" aria-label="CEP" value={form.cep} onChange={(event) => definir("cep", mascaraCep(event.target.value))} /></Campo>
                  <Campo label="Logradouro" obrigatorio erro={erros.logradouro} className="sm:col-span-2"><input className={entrada(erros.logradouro)} maxLength={255} autoComplete="address-line1" placeholder="Rua, avenida ou travessa" aria-label="Logradouro" value={form.logradouro} onChange={(event) => definir("logradouro", texto(event.target.value, 255))} /></Campo>
                  <Campo label="Número" obrigatorio erro={erros.numero}><input className={entrada(erros.numero)} maxLength={10} placeholder="123 ou S/N" aria-label="Número" value={form.numero} onChange={(event) => definir("numero", texto(event.target.value, 10).toUpperCase())} /></Campo>
                  <Campo label="Complemento"><input className={entrada()} maxLength={100} placeholder="Sala, conjunto ou andar" aria-label="Complemento" value={form.complemento} onChange={(event) => definir("complemento", texto(event.target.value, 100))} /></Campo>
                  <Campo label="Bairro" obrigatorio erro={erros.bairro}><input className={entrada(erros.bairro)} maxLength={50} placeholder="Bairro" aria-label="Bairro" value={form.bairro} onChange={(event) => definir("bairro", texto(event.target.value, 50))} /></Campo>
                  <Campo label="Cidade" obrigatorio erro={erros.cidade}><input className={entrada(erros.cidade)} maxLength={100} placeholder="São Paulo" aria-label="Cidade" value={form.cidade} onChange={(event) => definir("cidade", texto(event.target.value, 100))} /></Campo>
                  <Campo label="UF" obrigatorio erro={erros.uf}><input className={entrada(erros.uf)} maxLength={2} placeholder="SP" aria-label="UF" value={form.uf} onChange={(event) => definir("uf", event.target.value.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase())} /></Campo>
                </div>
                <p className="mb-3 mt-6 text-sm font-bold text-[#6a4b84]">Responsável pelo cadastro</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo label="Nome completo" obrigatorio erro={erros.nome}><input className={entrada(erros.nome)} maxLength={150} autoComplete="name" placeholder="Seu nome e sobrenome" aria-label="Nome completo" value={form.nome} onChange={(event) => definir("nome", texto(event.target.value, 150))} /></Campo>
                  <Campo label="Cargo na empresa" obrigatorio erro={erros.cargo}><input className={entrada(erros.cargo)} maxLength={80} placeholder="Ex.: Gerente de RH" aria-label="Cargo na empresa" value={form.cargo} onChange={(event) => definir("cargo", texto(event.target.value, 80))} /></Campo>
                  <Campo label="E-mail corporativo" obrigatorio erro={erros.email}><input className={entrada(erros.email)} type="email" inputMode="email" autoComplete="email" maxLength={255} placeholder="seunome@empresa.com.br" aria-label="E-mail corporativo" value={form.email} onChange={(event) => definir("email", texto(event.target.value, 255).replace(/\s/g, "").toLowerCase())} /></Campo>
                  <Campo label="Telefone do responsável" obrigatorio erro={erros.telefoneResponsavel}><input className={entrada(erros.telefoneResponsavel)} inputMode="tel" autoComplete="tel" maxLength={15} placeholder="(11) 99999-9999" aria-label="Telefone do responsável" value={form.telefoneResponsavel} onChange={(event) => definir("telefoneResponsavel", mascaraTelefone(event.target.value))} /></Campo>
                </div>
              </section>
            ) : null}

            {etapa === 2 ? (
              <section>
                <Cabeca titulo="Conte como é sua primeira vaga" texto="Essas informações ajudam a DNA Work a encontrar candidatos aderentes ao perfil." />
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button type="button" className={segmento(form.modalidade === "clt")} onClick={() => definir("modalidade", "clt")}><b>Contratação CLT</b><small className="block font-normal text-[#6f6578]">Profissionais para sua equipe</small></button>
                  <button type="button" className={segmento(form.modalidade === "estagio")} onClick={() => definir("modalidade", "estagio")}><b>Estágio</b><small className="block font-normal text-[#6f6578]">Estudantes em formação</small></button>
                </div>
                {form.modalidade === "estagio" ? (
                  <div className="mt-4 grid gap-2">
                    <p className="text-sm font-semibold">Para quem é o estágio?<span className="text-rose-600"> *</span></p>
                    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Nível de ensino do estágio">
                      {NIVEIS.map(([valor, rotulo, explicacao]) => (
                        <button key={valor} type="button" role="radio" aria-checked={form.nivelEnsino === valor} className={segmento(form.nivelEnsino === valor)} onClick={() => definir("nivelEnsino", valor)}>
                          <b>{rotulo}</b><small className="block font-normal text-[#6f6578]">{explicacao}</small>
                        </button>
                      ))}
                    </div>
                    {erros.nivelEnsino ? <span className="text-sm font-medium text-rose-600">{erros.nivelEnsino}</span> : null}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Campo label="Nome do cargo" obrigatorio erro={erros.vaga}><input className={entrada(erros.vaga)} maxLength={180} placeholder="Ex.: Operador de telemarketing" aria-label="Nome do cargo" value={form.vaga} onChange={(event) => definir("vaga", texto(event.target.value, 180))} /></Campo>
                  <Campo label="Quantidade de posições" obrigatorio erro={erros.quantidade}><input className={entrada(erros.quantidade)} inputMode="numeric" maxLength={3} aria-label="Quantidade de posições" value={form.quantidade} onChange={(event) => definir("quantidade", digitos(event.target.value, 3))} /></Campo>
                  <Campo label={form.modalidade === "estagio" ? "Bolsa" : "Salário"} obrigatorio erro={erros.salario}><input className={entrada(erros.salario)} inputMode="decimal" maxLength={20} placeholder="Ex.: 1.850,00" aria-label={form.modalidade === "estagio" ? "Bolsa" : "Salário"} value={form.salario} onChange={(event) => definir("salario", event.target.value.replace(/[^\d.,]/g, "").slice(0, 20))} /></Campo>
                  <Campo label="Benefícios" erro={erros.beneficios}><input className={entrada()} maxLength={255} placeholder="Ex.: VT, VR e assistência médica" aria-label="Benefícios" value={form.beneficios} onChange={(event) => definir("beneficios", texto(event.target.value, 255))} /></Campo>
                  <Campo label="Jornada e escala" obrigatorio erro={erros.jornada} className="sm:col-span-2"><input className={entrada(erros.jornada)} maxLength={255} placeholder="Segunda a sexta, 08h às 17h" aria-label="Jornada e escala" value={form.jornada} onChange={(event) => definir("jornada", texto(event.target.value, 255))} /></Campo>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={mesmoEndereco} onChange={(event) => usarEnderecoEmpresa(event.target.checked)} /> Usar o endereço da empresa</label>
                  <Campo label="Endereço de trabalho" obrigatorio erro={erros.endereco} className="sm:col-span-2"><input className={entrada(erros.endereco)} maxLength={255} placeholder="Rua, número e bairro" aria-label="Endereço de trabalho" value={form.endereco} onChange={(event) => { setMesmoEndereco(false); definir("endereco", texto(event.target.value, 255)); }} /></Campo>
                  <Campo label="Cidade da vaga" obrigatorio erro={erros.cidadevaga}><input className={entrada(erros.cidadevaga)} maxLength={100} placeholder="São Paulo" aria-label="Cidade da vaga" value={form.cidadevaga} onChange={(event) => definir("cidadevaga", texto(event.target.value, 100))} /></Campo>
                  <Campo label="UF da vaga" obrigatorio erro={erros.ufvaga}><input className={entrada(erros.ufvaga)} maxLength={2} placeholder="SP" aria-label="UF da vaga" value={form.ufvaga} onChange={(event) => definir("ufvaga", event.target.value.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase())} /></Campo>
                  <Campo label="Principais atividades" obrigatorio erro={erros.atividades} className="sm:col-span-2">
                    <textarea className={`${entrada(erros.atividades)} h-28 py-2`} maxLength={2000} placeholder="Descreva resumidamente o dia a dia desta função" aria-label="Principais atividades" value={form.atividades} onChange={(event) => definir("atividades", texto(event.target.value, 2000))} />
                    <span className="text-xs font-normal text-[#8c7d95]">{form.atividades.trim().length}/2000</span>
                  </Campo>
                </div>
              </section>
            ) : null}

            {etapa === 3 ? (
              <section>
                <Cabeca titulo="Tudo certo. Falta só conferir." texto="Revise a empresa, a vaga e as condições antes de concluir." />
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Resumo titulo="Sua empresa" linhas={[["Empresa", form.fantasia || form.razao], ["CNPJ", form.cnpj], ["Responsável", form.nome], ["E-mail de acesso", form.email]]} />
                  <Resumo titulo="Sua primeira vaga" linhas={[["Cargo", form.vaga], ["Modalidade", form.modalidade === "clt" ? "Contratação CLT" : "Estágio"], ...(form.modalidade === "estagio" && form.nivelEnsino ? [["Nível de ensino", ROTULO_NIVEL[form.nivelEnsino]] as [string, string]] : []), ["Posições", form.quantidade], ["Localidade", `${form.cidadevaga}/${form.ufvaga}`]]} />
                </div>
                <div className="mt-4 rounded-2xl bg-[#f7f2fa] p-4 text-sm">
                  <h3 className="font-bold">{condicoes?.titulo ?? "Condições comerciais"}</h3>
                  <ul className="mt-2 grid gap-1 text-[#4c3d58]">
                    {(condicoes?.itens ?? []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <p className="mt-2 text-[#6f6578]">{termos?.aviso}</p>
                </div>
                <button type="button" className="mt-3 text-sm font-bold text-[#6a4b84] underline" onClick={() => setModal(true)}>Ler o termo completo</button>
                <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={form.termos} onChange={(event) => definir("termos", event.target.checked)} /> <span>Li e aceito os termos e as condições comerciais desta modalidade.</span></label>
                {erros.termos ? <p className="mt-1 text-sm text-rose-600">{erros.termos}</p> : null}
                <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={form.poderes} onChange={(event) => definir("poderes", event.target.checked)} /> <span>Confirmo que posso representar a empresa neste cadastro.</span></label>
                {erros.poderes ? <p className="mt-1 text-sm text-rose-600">{erros.poderes}</p> : null}
              </section>
            ) : null}

            {etapa === 4 && conclusao ? (
              <section className="py-6 text-center">
                <div className="cadastro-pop mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#f3e8f5] text-3xl text-[#6a4b84]">✓</div>
                <h2 className="mt-4 text-2xl font-extrabold">Cadastro concluído</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#6f6578]">A empresa e a vaga já estão no portal. Guarde esta senha: ela aparece só agora. No primeiro acesso, o portal pede uma senha nova.</p>
                <dl className="mx-auto mt-5 grid max-w-md gap-2 rounded-2xl bg-[#f7f2fa] p-4 text-left text-sm">
                  <div><dt className="text-[#8c7d95]">Login</dt><dd className="font-bold">{conclusao.email}</dd></div>
                  <div><dt className="text-[#8c7d95]">Senha temporária</dt><dd className="font-bold tracking-wide">{conclusao.senha}</dd></div>
                  <div><dt className="text-[#8c7d95]">Comprovante do aceite</dt><dd className="font-bold">{conclusao.comprovante}</dd></div>
                  <div><dt className="text-[#8c7d95]">Termo</dt><dd>Versão {conclusao.versao} · {new Date(conclusao.aceitoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de São Paulo)</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className="h-11 rounded-xl border border-[#e9e2ee] px-4 text-sm font-bold text-[#6a4b84]" onClick={() => void copiarSenha()}>{copiado ? "Senha copiada" : "Copiar senha"}</button>
                  <Link to="/login" className="inline-flex h-11 items-center rounded-xl bg-[#6a4b84] px-4 text-sm font-bold text-white">Entrar no portal</Link>
                </div>
              </section>
            ) : null}

            {aviso ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{aviso}</p> : null}
            {etapa < 4 ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {etapa > 1 ? <button type="button" className="h-11 rounded-xl px-3 text-sm font-bold text-[#6a4b84]" onClick={() => ir(etapa - 1)}>Voltar</button> : <span className="text-sm text-[#8c7d95]">Dados tratados com segurança</span>}
                <button className="h-11 rounded-xl bg-[#6a4b84] px-5 text-sm font-bold text-white disabled:opacity-60" disabled={enviando}>{etapa === 3 ? (enviando ? "Concluindo…" : "Concluir cadastro") : "Continuar"}</button>
              </div>
            ) : null}
          </form>
        </div>
        <aside className="grid content-start gap-4">
          <div className="rounded-3xl border border-[#eee9f2] bg-white p-5">
            <h2 className="font-extrabold">O diferencial DNA Work</h2>
            <ol className="mt-4 grid gap-4 text-sm">
              <li><b>Entendemos seu perfil.</b> Analisamos os critérios e requisitos da vaga.</li>
              <li><b>Avaliamos o trajeto.</b> Consideramos distância, tempo e conduções.</li>
              <li><b>Filtramos candidatos.</b> Cruzamos currículo, compatibilidade e avaliação.</li>
              <li><b>Você recebe os melhores.</b> Candidatos pré-selecionados para avaliar.</li>
            </ol>
          </div>
          <div className="rounded-3xl bg-[#6a4b84] p-5 text-white">
            <h2 className="text-xl font-extrabold">Uma parceria, do seu jeito.</h2>
            <p className="mt-2 text-sm text-white/85">Sem exclusividade ou obrigação de abrir um número mínimo de vagas. Você acompanha tudo em um só lugar.</p>
            <p className="mt-4 text-sm font-bold">Portal exclusivo para empresas</p>
          </div>
        </aside>
      </main>
      {modal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#24182d]/50 p-4" onClick={(event) => { if (event.target === event.currentTarget) setModal(false); }}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-3xl bg-white p-5" role="dialog" aria-modal="true" aria-labelledby="titulo-termo">
            <h2 id="titulo-termo" className="text-lg font-extrabold">{termos?.titulo ?? "Termos"}</h2>
            <p className="mt-2 rounded-xl bg-[#fff7e8] p-3 text-sm">{termos?.aviso}</p>
            <div className="mt-4 grid gap-3 text-sm">
              {(termos?.clausulas ?? []).map((clausula) => (
                <section key={clausula.titulo}><h3 className="font-bold">{clausula.titulo}</h3><p className="text-[#4c3d58]">{clausula.texto}</p></section>
              ))}
            </div>
            <button type="button" className="mt-5 h-11 rounded-xl bg-[#6a4b84] px-4 text-sm font-bold text-white" onClick={() => setModal(false)}>Fechar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cabeca({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <h2 className="text-xl font-extrabold">{titulo}</h2>
      <p className="mt-1 text-sm text-[#6f6578]">{texto}</p>
    </div>
  );
}

function Campo({ label, obrigatorio, erro, className = "", children }: { label: string; obrigatorio?: boolean; erro?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`grid gap-1.5 text-sm font-semibold ${className}`}>
      <span>{label}{obrigatorio ? <span className="text-rose-600"> *</span> : null}</span>
      {children}
      {erro ? <span className="text-sm font-medium text-rose-600">{erro}</span> : null}
    </label>
  );
}

function Resumo({ titulo, linhas }: { titulo: string; linhas: string[][] }) {
  return (
    <div className="rounded-2xl border border-[#eee9f2] p-4 text-sm">
      <b>{titulo}</b>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents"><dt className="text-[#8c7d95]">{rotulo}</dt><dd className="font-semibold">{valor || "—"}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function entrada(erro?: string) {
  return `h-11 w-full rounded-xl border px-3 text-sm font-normal outline-none focus:ring-4 ${erro ? "border-rose-400 focus:ring-rose-100" : "border-[#eadff0] focus:border-[#6a4b84] focus:ring-[#6a4b84]/15"}`;
}

function segmento(ativo: boolean) {
  return `rounded-2xl border px-4 py-3 text-left text-sm ${ativo ? "border-[#6a4b84] bg-[#f7f2fa]" : "border-[#eee9f2] bg-white"}`;
}
