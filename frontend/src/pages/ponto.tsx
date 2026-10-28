import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";

type Linha = Record<string, string | number | null>;

export function Listagem({ titulo, caminho, novo, colunas }: { titulo: string; caminho: string; novo?: string; colunas: Array<{ chave: string; titulo: string }> }) {
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
                {colunas.map((coluna) => <td key={coluna.chave} className="px-4 py-3">{linha[coluna.chave] ?? "—"}</td>)}
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
  return <Listagem titulo="Cartão ponto" caminho="/api/v1/empresa/ponto/relatorio" colunas={[
    { chave: "nome", titulo: "Colaborador" }, { chave: "data", titulo: "Data" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida", titulo: "Saída" }, { chave: "horas", titulo: "Horas" },
  ]} />;
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
