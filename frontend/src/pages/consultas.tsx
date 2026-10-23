import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type Linha = Record<string, string | null>;

export function Inicio() {
  const painel = useQuery({ queryKey: ["painel-empresa"], queryFn: () => api<{ empresa: string; cnpj: string; colaboradoresAtivos: number; vagasAbertas: number; contratos: number }>("/api/v1/empresa/painel") });
  const dados = painel.data?.data;
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-2xl font-extrabold">{dados?.empresa || "Início"}</h2>
        <p className="text-sm text-slate-500">{dados?.cnpj}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Resumo titulo="Colaboradores ativos" valor={dados?.colaboradoresAtivos} />
        <Resumo titulo="Vagas abertas" valor={dados?.vagasAbertas} />
        <Resumo titulo="Contratos" valor={dados?.contratos} />
      </div>
    </section>
  );
}

export function Consulta({ titulo, caminho, colunas }: { titulo: string; caminho: string; colunas: Array<{ chave: string; titulo: string }> }) {
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const lista = useQuery({
    queryKey: [caminho, busca],
    queryFn: () => api<Linha[]>(`${caminho}?q=${encodeURIComponent(busca)}`),
  });
  const linhas = lista.data?.data ?? [];
  return (
    <section className="grid gap-4">
      <h2 className="text-2xl font-extrabold">{titulo}</h2>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setBusca(q.trim()); }}>
        <input className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Buscar por nome ou cargo" value={q} onChange={(event) => setQ(event.target.value)} />
        <button className="rounded-xl bg-[#5b21b6] px-4 text-sm font-bold text-white">Buscar</button>
      </form>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr>{colunas.map((coluna) => <th key={coluna.chave} className="px-4 py-3">{coluna.titulo}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((linha, index) => (
              <tr key={index} className="border-t border-slate-100">
                {colunas.map((coluna) => <td key={coluna.chave} className="px-4 py-3">{linha[coluna.chave] || "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.isLoading && linhas.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">Nenhum registro desta empresa.</p> : null}
      </div>
    </section>
  );
}

function Resumo({ titulo, valor }: { titulo: string; valor?: number }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="mt-1 text-3xl font-extrabold text-[#5b21b6]">{valor ?? "—"}</p>
    </article>
  );
}
