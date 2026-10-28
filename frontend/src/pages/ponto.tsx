import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";

type Linha = Record<string, string | number | null>;

export function Listagem({ titulo, caminho, novo, colunas, linkNome, linkColuna = "nome" }: { titulo: string; caminho: string; novo?: string; colunas: Array<{ chave: string; titulo: string }>; linkNome?: (linha: Linha) => string | null; linkColuna?: string }) {
  const lista = useQuery({ queryKey: [caminho], queryFn: () => api<Linha[]>(caminho) });
  const linhas = Array.isArray(lista.data?.data) ? lista.data.data : [];
  const navigate = useNavigate();
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">{titulo}</h2>
          {!lista.isLoading && !lista.isError ? <p className="text-sm text-[#6f6578]">{linhas.length === 1 ? "1 registro" : `${linhas.length} registros`}</p> : null}
        </div>
        {novo ? <button className="rounded-lg bg-[#6a4b84] px-4 py-2 text-sm font-semibold text-white hover:bg-[#593d70]" onClick={() => navigate(novo)}>Cadastrar</button> : null}
      </div>
      {lista.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-700">{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar esta lista."}</p> : null}
      <div className="overflow-x-auto rounded-xl bg-white text-[#24182d] ring-1 ring-[#eadff0]">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-[#6f6578]"><tr>{colunas.map((coluna) => <th key={coluna.chave} className="px-4 py-3 font-medium">{coluna.titulo}</th>)}</tr></thead>
          <tbody>
            {linhas.map((linha, index) => (
              <tr key={String(linha.id ?? index)} className="border-t border-[#f0ebf3]">
                {colunas.map((coluna) => {
                  const texto = linha[coluna.chave] ?? "—";
                  const href = coluna.chave === linkColuna ? linkNome?.(linha) : null;
                  return <td key={coluna.chave} className="px-4 py-3">{href ? <RouterLink className="font-medium text-[#5b21b6] hover:underline" to={href}>{texto}</RouterLink> : texto}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.isLoading && !lista.isError && linhas.length === 0 ? <p className="px-4 py-6 text-sm text-[#6f6578]">Nenhum registro desta empresa.</p> : null}
      </div>
    </section>
  );
}

export function ColaboradorNovo() {
  return <Formulario titulo="Cadastrar colaborador" destino="/api/v1/empresa/colaboradores" voltar="/colaboradores" campos={[
    ["nome", "Nome", "text"], ["cpf", "CPF", "text"], ["email", "E-mail", "email"], ["celular", "Celular", "text"],
    ["cargo", "Cargo", "text"], ["departamento", "Departamento", "text"], ["inicio", "Início", "date"],
  ]} />;
}

export function EscalaNova() {
  const cargas = useQuery({ queryKey: ["cargas-opcoes"], queryFn: () => api<Array<{ id: number; nome: string }>>("/api/v1/empresa/cargas") });
  const opcoes = (cargas.data?.data ?? []).map((carga) => ({ valor: String(carga.id), rotulo: carga.nome }));
  return <Formulario titulo="Cadastrar escala" destino="/api/v1/empresa/escalas" voltar="/escalas" campos={[
    ["nome", "Nome", "text"],
    ["segunda", "Segunda", "select", opcoes], ["terca", "Terça", "select", opcoes], ["quarta", "Quarta", "select", opcoes],
    ["quinta", "Quinta", "select", opcoes], ["sexta", "Sexta", "select", opcoes], ["sabado", "Sábado", "select", opcoes], ["domingo", "Domingo", "select", opcoes],
  ]} />;
}

export function CargaNova() {
  return <Formulario titulo="Cadastrar carga horária" destino="/api/v1/empresa/cargas" voltar="/cargas" campos={[
    ["nome", "Nome", "text"], ["tipo", "Tipo", "select", [{ valor: "Diurno", rotulo: "Diurno" }, { valor: "Noturno", rotulo: "Noturno" }]],
    ["entrada", "Entrada", "time"], ["pausa", "Pausa para refeição", "select", [{ valor: "1", rotulo: "Sim" }, { valor: "0", rotulo: "Não" }]],
    ["saidaRefeicao", "Saída refeição", "time"], ["retornoRefeicao", "Retorno refeição", "time"], ["saida", "Saída", "time"], ["tolerancia", "Tolerância (min)", "text"],
  ]} />;
}

export function FeriadoNovo() {
  return <Formulario titulo="Cadastrar feriado" destino="/api/v1/empresa/feriados" voltar="/feriados" campos={[["nome", "Nome", "text"], ["data", "Data", "date"]]} />;
}

export function VagaNova({ tipo }: { tipo: string }) {
  const nome = tipo === "1" ? "Estágio" : tipo === "4" ? "PJ" : "CLT";
  return <Formulario titulo={`Abrir vaga ${nome}`} destino="/api/v1/empresa/vagas" voltar="/vagas" extra={{ tipo }} campos={[
    ["cargo", "Cargo", "text"], ["cidade", "Cidade", "text"], ["salario", "Salário", "text"],
  ]} />;
}

export function RelatorioPonto() {
  return <Listagem titulo="Cartão ponto" caminho="/api/v1/empresa/ponto/relatorio" linkNome={(linha) => linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null} colunas={[
    { chave: "nome", titulo: "Colaborador" }, { chave: "data", titulo: "Data" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida", titulo: "Saída" }, { chave: "horas", titulo: "Horas" },
  ]} />;
}

type DiaPonto = { data: string; dia: string; situacao: string; entrada1: string; saida1: string; entrada2: string; saida2: string; total: string; carga: string; saldo: string; saldoNegativo: boolean; banco: string; bancoNegativo: boolean };
type RelatorioPessoa = { nome: string; cargo: string; bancoHoras: boolean; semRegistro?: boolean; de?: string; ate?: string; dias: DiaPonto[] };

export function ColaboradoresPonto() {
  const [status, setStatus] = useState("todos");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const lista = useQuery({
    queryKey: ["ponto-colaboradores", status, busca],
    queryFn: () => api<Linha[]>(`/api/v1/empresa/colaboradores?status=${status}&q=${encodeURIComponent(busca)}`),
  });
  const linhas = Array.isArray(lista.data?.data) ? lista.data.data : [];
  const colunas = [
    { chave: "nome", titulo: "Colaborador" },
    { chave: "datainicio", titulo: "Contratação" },
    { chave: "departamento", titulo: "Departamento" },
    { chave: "cargo", titulo: "Cargo" },
    { chave: "modalidade", titulo: "Modalidade" },
    { chave: "situacao", titulo: "Situação" },
  ];
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">Colaboradores</h2>
          {!lista.isLoading && !lista.isError ? <p className="text-sm text-[#6f6578]">{linhas.length === 1 ? "1 registro" : `${linhas.length} registros`}</p> : null}
        </div>
        <div className="flex gap-2">
          {[["todos", "Todos"], ["ativo", "Ativo"], ["inativo", "Inativo"]].map(([valor, rotulo]) => (
            <button key={valor} type="button" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${status === valor ? "bg-[#6a4b84] text-white" : "bg-white text-[#6a4b84] ring-1 ring-[#eadff0]"}`} onClick={() => setStatus(valor)}>{rotulo}</button>
          ))}
        </div>
      </div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setBusca(q.trim()); }}>
        <input className="h-10 flex-1 rounded-lg border border-[#eadff0] bg-white px-3 text-sm outline-none focus:border-[#6a4b84] focus:ring-4 focus:ring-[#6a4b84]/15" placeholder="Buscar por nome ou cargo" value={q} onChange={(event) => setQ(event.target.value)} />
        <button className="rounded-lg bg-[#6a4b84] px-4 text-sm font-semibold text-white hover:bg-[#593d70]">Buscar</button>
      </form>
      {lista.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-700">{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar esta lista."}</p> : null}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-[#eadff0]">
        <table className="data-table min-w-[640px]">
          <thead><tr>{colunas.map((coluna) => <th key={coluna.chave}>{coluna.titulo}</th>)}</tr></thead>
          <tbody>
            {linhas.map((linha, index) => (
              <tr key={String(linha.id_candidato ?? index)}>
                {colunas.map((coluna) => {
                  const texto = linha[coluna.chave] || "—";
                  const href = coluna.chave === "nome" && linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null;
                  return <td key={coluna.chave}>{href ? <RouterLink className="font-medium text-[#5b21b6] hover:underline" to={href}>{texto}</RouterLink> : texto}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.isLoading && !lista.isError && linhas.length === 0 ? <p className="px-4 py-8 text-sm text-[#7a6b86]">Nenhum colaborador neste status.</p> : null}
      </div>
    </section>
  );
}

export function RelatorioPontoColaborador({ id }: { id: string }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [periodo, setPeriodo] = useState<{ de?: string; ate?: string }>({});
  const relatorio = useQuery({
    queryKey: ["ponto-colaborador", id, periodo.de ?? "", periodo.ate ?? ""],
    queryFn: () => api<RelatorioPessoa>(`/api/v1/empresa/ponto/colaborador/${id}?de=${periodo.de ?? ""}&ate=${periodo.ate ?? ""}`),
  });
  const pessoa = relatorio.data?.data;
  const dias = pessoa?.dias ?? [];
  useEffect(() => {
    if (!periodo.de && pessoa?.de) setDe(pessoa.de);
    if (!periodo.ate && pessoa?.ate) setAte(pessoa.ate);
  }, [pessoa?.de, pessoa?.ate, periodo.de, periodo.ate]);
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-[#24182d]">Relatório ponto</h2>
        <p className="text-sm text-[#6f6578]">{[pessoa?.nome, pessoa?.cargo].filter(Boolean).join(" · ")}</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setPeriodo({ de, ate }); }}>
        <label className="grid gap-1 text-xs text-[#6f6578]">De
          <input className="h-10 rounded-lg border border-[#eadff0] bg-white px-3 text-sm text-[#24182d]" type="date" value={de} onChange={(event) => setDe(event.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-[#6f6578]">Até
          <input className="h-10 rounded-lg border border-[#eadff0] bg-white px-3 text-sm text-[#24182d]" type="date" value={ate} onChange={(event) => setAte(event.target.value)} />
        </label>
        <button className="h-10 rounded-lg bg-[#6a4b84] px-4 text-sm font-semibold text-white">Pesquisar</button>
      </form>
      {relatorio.isLoading ? <p className="text-sm text-[#7a6b86]">Carregando…</p> : null}
      {relatorio.isError ? <p className="text-sm text-rose-700">{relatorio.error instanceof ApiError ? relatorio.error.message : "Não foi possível carregar o relatório."}</p> : null}
      {pessoa?.semRegistro ? <p className="rounded-xl bg-white px-4 py-6 text-sm text-[#6f6578] ring-1 ring-[#eadff0]">Esta pessoa ainda não tem cadastro de ponto nesta empresa.</p> : null}
      {pessoa && !pessoa.semRegistro ? (
        <div className="overflow-x-auto rounded-xl bg-white text-[#24182d] ring-1 ring-[#eadff0]">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-[#6f6578]">
              <tr>
                {["Data", "Dia", "Ent. 1", "Saí. 1", "Ent. 2", "Saí. 2", "Total", "Carga", "Saldo", "B. Horas"].map((titulo) => <th key={titulo} className="px-3 py-3 font-medium">{titulo}</th>)}
              </tr>
            </thead>
            <tbody>
              {dias.map((dia) => (
                <tr key={dia.data} className="border-t border-[#f0ebf3]">
                  <td className="px-3 py-3">{dia.data}</td>
                  <td className="px-3 py-3">{dia.dia}</td>
                  <td className="px-3 py-3">{dia.situacao || dia.entrada1 || "—"}</td>
                  <td className="px-3 py-3">{dia.saida1 || "—"}</td>
                  <td className="px-3 py-3">{dia.entrada2 || "—"}</td>
                  <td className="px-3 py-3">{dia.saida2 || "—"}</td>
                  <td className="px-3 py-3">{dia.total}</td>
                  <td className="px-3 py-3">{dia.carga}</td>
                  <td className={`px-3 py-3 ${dia.saldoNegativo ? "text-rose-700" : ""}`}>{dia.saldo}</td>
                  <td className={`px-3 py-3 ${dia.bancoNegativo ? "text-rose-700" : ""}`}>{dia.banco || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!relatorio.isLoading && !relatorio.isError && dias.length === 0 ? <p className="px-4 py-6 text-sm text-[#6f6578]">Nenhum dia neste período.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function Formulario({ titulo, destino, voltar, campos, extra = {} }: {
  titulo: string;
  destino: string;
  voltar: string;
  extra?: Record<string, string>;
  campos: Array<[string, string, string, Array<{ valor: string; rotulo: string }>?]>;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const navigate = useNavigate();
  const client = useQueryClient();
  const salvar = useMutation({
    mutationFn: () => api(destino, { method: "POST", body: JSON.stringify({ ...extra, ...valores }) }),
    onSuccess: async () => {
      await client.invalidateQueries();
      navigate(voltar);
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível salvar."),
  });
  return (
    <form className="grid max-w-xl gap-4 rounded-3xl bg-white p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); setErro(""); salvar.mutate(); }}>
      <h2 className="text-2xl font-extrabold">{titulo}</h2>
      {campos.map(([chave, rotulo, tipo, opcoes]) => (
        <label key={chave} className="grid gap-1 text-sm font-semibold">{rotulo}
          {tipo === "select" ? (
            <select className="h-11 rounded-xl border border-slate-200 px-3 font-normal" value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })}>
              <option value="">Selecione</option>
              {(opcoes ?? []).map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
            </select>
          ) : (
            <input required={tipo !== "time" && chave !== "email" && chave !== "celular" && chave !== "departamento" && chave !== "salario" && chave !== "cidade" && chave !== "tolerancia"} className="h-11 rounded-xl border border-slate-200 px-3 font-normal" type={tipo} value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })} />
          )}
        </label>
      ))}
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      <button className="h-11 rounded-xl bg-[#5b21b6] font-bold text-white" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar"}</button>
    </form>
  );
}
