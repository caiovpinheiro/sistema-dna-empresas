import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Printer, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { filtrar } from "../lib/busca";
import { dataBr } from "../lib/formato";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Empty, Field, Input, Resumo, Skeleton, cn } from "../components/ui";
import { CampoBusca } from "./consultas";

/** Minutos em horas e minutos: 754 → "12h34m"; com sinal: "+12h34m" / "-0h05m". */
export function horasMin(minutos: number, comSinal = false) {
  const abs = Math.abs(Math.round(minutos));
  const texto = `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}m`;
  if (!comSinal) return texto;
  return `${minutos < 0 ? "-" : minutos > 0 ? "+" : ""}${texto}`;
}

/** Saldo colorido: verde sobrando, vermelho faltando. */
export function Saldo({ minutos, className = "" }: { minutos: number | null | undefined; className?: string }) {
  if (minutos === null || minutos === undefined) return <span className="text-slate-400">—</span>;
  return <span className={cn("font-bold tabular-nums", minutos < 0 ? "text-rose-700" : minutos > 0 ? "text-emerald-700" : "text-slate-500", className)}>{horasMin(minutos, true)}</span>;
}

type LinhaRelatorio = {
  id_candidato: string; nome: string; cargo: string; departamento: string; jornada: string; modalidade: string; situacao: string;
  feitos: number; previstos: number; saldo: number; saldoTotal: number | null; noturnos?: number;
  diasTrabalhados: number; faltas: number; incompletas: number; atestados: number; almocoPerto: number; estagioAcima: boolean;
};
type Relatorio = { de: string; ate: string; linhas: LinhaRelatorio[] };

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somar = (iso: string, dias: number) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};
/**
 * Atalhos de período pelo calendário, não pelos últimos N dias: a semana começa na segunda, o mês no dia 1 e o ano em
 * 1º de janeiro, sempre até hoje.
 */
function atalhos() {
  const hoje = hojeIso();
  const segunda = somar(hoje, -((new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7));
  return [
    { rotulo: "Esta semana", de: segunda, ate: hoje },
    { rotulo: "Este mês", de: `${hoje.slice(0, 8)}01`, ate: hoje },
    { rotulo: "Este ano", de: `${hoje.slice(0, 5)}01-01`, ate: hoje },
  ];
}

/** Relatório de ponto do período: uma linha por colaborador com horas feitas, previstas e o saldo. */
export function RelatorioPonto() {
  const [parametros, setParametros] = useSearchParams();
  const padrao = atalhos()[0];
  const periodo = { de: parametros.get("de") || padrao.de, ate: parametros.get("ate") || padrao.ate };
  const [de, setDe] = useState(periodo.de);
  const [ate, setAte] = useState(periodo.ate);
  const [busca, setBusca] = useState("");
  useEffect(() => { setDe(periodo.de); setAte(periodo.ate); }, [periodo.de, periodo.ate]);
  const relatorio = useQuery({
    queryKey: ["/api/v1/empresa/ponto/relatorio", periodo.de, periodo.ate],
    queryFn: () => api<Relatorio>(`/api/v1/empresa/ponto/relatorio?de=${periodo.de}&ate=${periodo.ate}`),
  });
  const escolher = (novoDe: string, novoAte: string) => setParametros({ de: novoDe, ate: novoAte });
  const todas = relatorio.data?.data.linhas ?? [];
  const linhas = filtrar(todas, busca, ["nome", "cargo", "departamento", "jornada", "modalidade", "situacao"]);
  const total = linhas.reduce((soma, linha) => ({
    feitos: soma.feitos + linha.feitos, previstos: soma.previstos + linha.previstos, saldo: soma.saldo + linha.saldo, faltas: soma.faltas + linha.faltas,
  }), { feitos: 0, previstos: 0, saldo: 0, faltas: 0 });
  // Coluna de horas noturnas (22h às 5h, hora reduzida) só quando alguém trabalhou à noite: base do adicional noturno.
  const temNoturno = linhas.some((linha) => linha.noturnos);
  const linkPessoa = (linha: LinhaRelatorio) => `/ponto/colaborador/${linha.id_candidato}?de=${periodo.de}&ate=${periodo.ate}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Relatório de ponto"
        descricao={`Horas de cada colaborador de ${dataBr(periodo.de)} a ${dataBr(periodo.ate)}: o que fez, o que devia fazer e o saldo. Clique no nome para ver dia a dia.`}
        acoes={<Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Imprimir</Button>}
      />
      <Card className="grid gap-3 print:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {atalhos().map((atalho) => {
            const ativo = atalho.de === periodo.de && atalho.ate === periodo.ate;
            return (
              <button key={atalho.rotulo} type="button" aria-pressed={ativo} onClick={() => escolher(atalho.de, atalho.ate)}
                className={cn("inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold ring-1 transition", ativo ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                {atalho.rotulo}
              </button>
            );
          })}
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (de && ate) escolher(de, ate); }}>
          <Field label="De" className="w-full sm:w-44"><Input type="date" value={de} onChange={(event) => setDe(event.target.value)} /></Field>
          <Field label="Até" className="w-full sm:w-44"><Input type="date" value={ate} max={hojeIso()} onChange={(event) => setAte(event.target.value)} /></Field>
          <Button type="submit" className="h-10"><Search size={16} /> Ver período</Button>
          <div className="flex min-w-[14rem] flex-1"><CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar colaborador, cargo, jornada…" /></div>
        </form>
      </Card>
      {relatorio.isError ? <Alerta>{relatorio.error instanceof ApiError ? relatorio.error.message : "Não foi possível carregar o relatório."}</Alerta> : null}
      {relatorio.isLoading ? <Skeleton className="h-72" /> : null}
      {!relatorio.isLoading && !relatorio.isError ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card><p className="text-xs font-semibold text-slate-500">Horas trabalhadas</p><p className="text-xl font-extrabold tabular-nums text-ink">{horasMin(total.feitos)}</p></Card>
            <Card><p className="text-xs font-semibold text-slate-500">Horas previstas</p><p className="text-xl font-extrabold tabular-nums text-ink">{horasMin(total.previstos)}</p></Card>
            <Card><p className="text-xs font-semibold text-slate-500">Saldo do período</p><p className="text-xl"><Saldo minutos={total.saldo} /></p></Card>
            <Card><p className="text-xs font-semibold text-slate-500">Faltas</p><p className="text-xl font-extrabold tabular-nums text-ink">{total.faltas}</p></Card>
          </div>
          <Resumo total={linhas.length} singular="colaborador" plural="colaboradores" />
          {!linhas.length ? <Empty titulo={busca ? "Nada encontrado" : "Ninguém no período"} texto={busca ? "Confira a grafia ou limpe a busca." : "Não há colaboradores no ponto neste período."} /> : null}
          {linhas.length ? (
            <>
              <Card className="hidden p-0 md:block">
                <div className="overflow-x-auto">
                  <table className="data-table min-w-[960px]">
                    <thead>
                      <tr>
                        {["Colaborador", "Jornada", "Dias", "Trabalhado", ...(temNoturno ? ["Noturno"] : []), "Previsto", "Saldo do período", "Saldo total", "Ocorrências"].map((titulo) => <th key={titulo}>{titulo}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((linha) => (
                        <tr key={linha.id_candidato}>
                          <td>
                            <Link to={linkPessoa(linha)} className="font-semibold text-violet-700 hover:underline">{linha.nome}</Link>
                            <div className="text-xs text-slate-500">{[linha.cargo, linha.modalidade].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td className="text-sm text-slate-600">{linha.jornada || "—"}</td>
                          <td className="tabular-nums">{linha.diasTrabalhados}</td>
                          <td className="tabular-nums">{horasMin(linha.feitos)}</td>
                          {temNoturno ? <td className="tabular-nums text-slate-500">{linha.noturnos ? horasMin(linha.noturnos) : "—"}</td> : null}
                          <td className="tabular-nums text-slate-500">{horasMin(linha.previstos)}</td>
                          <td><Saldo minutos={linha.saldo} /></td>
                          <td><Saldo minutos={linha.saldoTotal} /></td>
                          <td><Ocorrencias linha={linha} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="grid gap-3 md:hidden">
                {linhas.map((linha) => (
                  <Link key={linha.id_candidato} to={linkPessoa(linha)} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-violet-700">{linha.nome}</p>
                        <p className="text-xs text-slate-500">{[linha.cargo, linha.jornada].filter(Boolean).join(" · ")}</p>
                      </div>
                      <ChevronRight size={16} className="text-slate-400" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <span><span className="block text-xs text-slate-500">Trabalhado</span>{horasMin(linha.feitos)}</span>
                      <span><span className="block text-xs text-slate-500">Período</span><Saldo minutos={linha.saldo} /></span>
                      <span><span className="block text-xs text-slate-500">Total</span><Saldo minutos={linha.saldoTotal} /></span>
                    </div>
                    <Ocorrencias linha={linha} />
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <p className="text-xs text-slate-500">
            Saldo do período: horas feitas menos as previstas, já com a tolerância da lei (5 min por batida, até 10 min no dia).
            Saldo total: do início do contrato até hoje. O dia de hoje só entra depois de fechado.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Ocorrencias({ linha }: { linha: LinhaRelatorio }) {
  const itens: Array<[string, string]> = [];
  if (linha.situacao === "Desligado") itens.push(["Desligado", "Desligado"]);
  if (linha.faltas) itens.push(["vencida", linha.faltas === 1 ? "1 falta" : `${linha.faltas} faltas`]);
  if (linha.incompletas) itens.push(["pendente", linha.incompletas === 1 ? "1 batida incompleta" : `${linha.incompletas} batidas incompletas`]);
  if (linha.atestados) itens.push(["Ativo", linha.atestados === 1 ? "1 atestado" : `${linha.atestados} atestados`]);
  if (linha.almocoPerto) itens.push(["almoco", linha.almocoPerto === 1 ? "1 almoço perto da entrada ou saída" : `${linha.almocoPerto} almoços perto da entrada ou saída`]);
  if (linha.estagioAcima) itens.push(["pendente", "Estágio acima da jornada"]);
  if (!itens.length) return <span className="text-sm text-slate-400">—</span>;
  return <div className="flex flex-wrap gap-1">{itens.map(([valor, texto]) => <Badge key={texto} value={valor}>{texto}</Badge>)}</div>;
}
