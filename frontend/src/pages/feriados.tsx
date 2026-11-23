import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { Alerta, Button, CabecalhoPagina, Card, Empty, Skeleton, cn } from "../components/ui";
import { Janela, useCadastroNaUrl } from "../components/janela";
import { FeriadoNovo } from "./ponto";

type Nacional = { data: string; nome: string };
type Cadastrado = {
  id: number;
  data: string;
  nome: string;
  abrangencia: "municipal" | "estadual" | "empresa";
  local: string | null;
  fixo: boolean;
  facultativo: boolean;
};
type Calendario = { ano: number; nacionais: Nacional[]; nacionaisDisponiveis: boolean; cadastrados: Cadastrado[] };

type Tipo = "nacional" | "empresa" | "facultativo";
type Dia = { data: string; nome: string; tipo: Tipo; cadastrado?: Cadastrado };

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ABRANGENCIA = { municipal: "Municipal", estadual: "Estadual", empresa: "Da empresa" } as const;

const COR: Record<Tipo, string> = {
  nacional: "bg-violet-600 text-white",
  empresa: "bg-amber-400 text-amber-950",
  facultativo: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-dashed ring-sky-400",
};
const BOLINHA: Record<Tipo, string> = {
  nacional: "bg-violet-600",
  empresa: "bg-amber-400",
  facultativo: "border border-dashed border-sky-500 bg-sky-50",
};

function hojeSp() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function diaDaSemana(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Prioridade quando dois feriados caem no mesmo dia: nacional > da empresa > facultativo. */
const PESO: Record<Tipo, number> = { nacional: 0, empresa: 1, facultativo: 2 };

export function FeriadosPage() {
  const [janela, abrirJanela, fecharJanela] = useCadastroNaUrl();
  const [ano, setAno] = useState(() => Number(hojeSp().slice(0, 4)));
  const calendario = useQuery({
    queryKey: ["/api/v1/empresa/feriados", ano],
    queryFn: () => api<Calendario>(`/api/v1/empresa/feriados?ano=${ano}`),
  });
  const dados = calendario.data?.data;

  const dias = useMemo(() => {
    const lista: Dia[] = [
      ...(dados?.nacionais ?? []).map((item) => ({ data: item.data, nome: item.nome, tipo: "nacional" as const })),
      ...(dados?.cadastrados ?? []).map((item) => ({ data: item.data, nome: item.nome, tipo: item.facultativo ? "facultativo" as const : "empresa" as const, cadastrado: item })),
    ];
    return lista.sort((a, b) => a.data.localeCompare(b.data) || PESO[a.tipo] - PESO[b.tipo]);
  }, [dados]);
  const porData = useMemo(() => {
    const mapa = new Map<string, Dia[]>();
    for (const dia of dias) mapa.set(dia.data, [...(mapa.get(dia.data) ?? []), dia]);
    return mapa;
  }, [dias]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Feriados"
        descricao="Os feriados nacionais entram sozinhos. Cadastre os municipais, estaduais e os dias de folga da empresa. Ponto facultativo aparece no calendário, mas não conta como feriado no ponto."
        acoes={<Button onClick={abrirJanela}><Plus size={16} /> Novo feriado</Button>}
      />
      <Janela
        titulo="Cadastrar feriado"
        descricao="Os feriados nacionais já entram sozinhos. Aqui ficam os da sua cidade, do seu estado e os dias de folga da empresa."
        aberta={janela}
        onFechar={fecharJanela}
      >
        <FeriadoNovo aoFechar={fecharJanela} />
      </Janela>

      <Card className="flex flex-wrap items-center justify-between gap-3 md:p-4">
        <div className="flex items-center gap-1" role="group" aria-label="Ano">
          <Button variant="ghost" aria-label="Ano anterior" onClick={() => setAno((valor) => valor - 1)}><ChevronLeft size={18} /></Button>
          <span className="min-w-16 text-center text-lg font-extrabold tabular-nums text-ink" aria-live="polite">{ano}</span>
          <Button variant="ghost" aria-label="Próximo ano" onClick={() => setAno((valor) => valor + 1)}><ChevronRight size={18} /></Button>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">
          {(["nacional", "empresa", "facultativo"] as Tipo[]).map((tipo) => (
            <li key={tipo} className="flex items-center gap-1.5">
              <span className={cn("h-3 w-3 rounded-full", BOLINHA[tipo])} aria-hidden="true" />
              {{ nacional: "Nacional", empresa: "Cadastrado pela empresa", facultativo: "Ponto facultativo" }[tipo]}
            </li>
          ))}
        </ul>
      </Card>

      {calendario.isError ? <Alerta>{calendario.error instanceof ApiError ? calendario.error.message : "Não foi possível carregar os feriados."}</Alerta> : null}
      {dados && !dados.nacionaisDisponiveis ? (
        <Alerta>Não foi possível buscar os feriados nacionais agora. Os feriados cadastrados aparecem normalmente; tente recarregar em instantes.</Alerta>
      ) : null}

      {calendario.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{MESES.map((mes) => <Skeleton key={mes} className="h-64" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MESES.map((nome, indice) => <Mes key={nome} ano={ano} mes={indice} nome={nome} porData={porData} />)}
        </div>
      )}

      {dados ? <Lista ano={ano} dias={dias} /> : null}
    </div>
  );
}

function Mes({ ano, mes, nome, porData }: { ano: number; mes: number; nome: string; porData: Map<string, Dia[]> }) {
  const hoje = hojeSp();
  const primeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const total = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const celulas = [...Array.from({ length: primeiro }, () => null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const doMes = [...porData.entries()].filter(([data]) => data.startsWith(`${ano}-${String(mes + 1).padStart(2, "0")}-`));
  return (
    <Card className="grid content-start gap-2 md:p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-extrabold text-ink">{nome}</h2>
        {doMes.length ? <span className="text-xs font-semibold text-slate-500">{doMes.length} {doMes.length === 1 ? "feriado" : "feriados"}</span> : null}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {SEMANA.map((letra, i) => <span key={i} className="py-1 font-bold text-slate-400" aria-hidden="true">{letra}</span>)}
        {celulas.map((dia, i) => {
          if (dia === null) return <span key={`v${i}`} />;
          const data = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
          const lista = porData.get(data);
          const tipo = lista?.[0]?.tipo;
          const fimDeSemana = i % 7 === 0 || i % 7 === 6;
          const titulo = lista?.map((item) => item.nome).join(" · ");
          return (
            <span
              key={data}
              title={titulo}
              aria-label={titulo ? `${dia} de ${MESES[mes].toLowerCase()}: ${titulo}` : undefined}
              className={cn(
                "mx-auto flex h-7 w-7 items-center justify-center rounded-full tabular-nums",
                tipo ? cn(COR[tipo], "font-bold") : fimDeSemana ? "text-slate-400" : "text-slate-700",
                data === hoje && "outline outline-2 outline-offset-1 outline-ink",
              )}
            >
              {dia}
            </span>
          );
        })}
      </div>
      {doMes.length ? (
        <ul className="grid gap-1 border-t border-slate-100 pt-2 text-xs">
          {doMes.map(([data, lista]) => (
            <li key={data} className="flex gap-2">
              <span className="w-5 shrink-0 font-bold tabular-nums text-slate-500">{Number(data.slice(8))}</span>
              <span className="min-w-0 text-slate-700">{lista.map((item) => item.nome).join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Lista({ ano, dias }: { ano: number; dias: Dia[] }) {
  const client = useQueryClient();
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const excluir = useMutation({
    mutationFn: (id: number) => api(`/api/v1/empresa/feriados/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmando(null);
      await client.invalidateQueries({ queryKey: ["/api/v1/empresa/feriados"] });
    },
  });
  const erro = excluir.error instanceof ApiError ? excluir.error.message : excluir.error ? "Não foi possível excluir o feriado." : "";
  return (
    <Card className="p-0">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-extrabold text-ink">Feriados de {ano}</h2>
      {erro ? <div className="px-4 pt-3"><Alerta>{erro}</Alerta></div> : null}
      {dias.length === 0 ? (
        <div className="p-4"><Empty titulo="Nenhum feriado neste ano" texto="Cadastre os feriados da sua cidade e os dias de folga da empresa." /></div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {dias.map((dia, indice) => {
            const [a, m, d] = dia.data.split("-");
            const item = dia.cadastrado;
            return (
              <li key={`${dia.data}-${indice}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className={cn("h-3 w-3 shrink-0 rounded-full", BOLINHA[dia.tipo])} aria-hidden="true" />
                <div className="w-28 shrink-0 text-sm">
                  <p className="font-bold tabular-nums text-ink">{d}/{m}/{a}</p>
                  <p className="text-xs text-slate-500">{SEMANA_LONGA[diaDaSemana(dia.data)]}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{dia.nome}</p>
                  <p className="text-xs text-slate-500">
                    {item
                      ? [ABRANGENCIA[item.abrangencia], item.local, item.fixo ? "Todo ano" : `Só em ${ano}`, item.facultativo ? "Ponto facultativo" : null].filter(Boolean).join(" · ")
                      : "Nacional · automático"}
                  </p>
                </div>
                {item ? (
                  confirmando === item.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink">{item.fixo ? "Excluir de todos os anos?" : "Excluir este feriado?"}</span>
                      <Button variant="ghost" onClick={() => setConfirmando(null)} disabled={excluir.isPending}>Voltar</Button>
                      <Button variant="danger" onClick={() => excluir.mutate(item.id)} disabled={excluir.isPending}>{excluir.isPending ? "Excluindo…" : "Excluir"}</Button>
                    </div>
                  ) : (
                    <Button variant="ghost" aria-label={`Excluir ${dia.nome}`} onClick={() => { excluir.reset(); setConfirmando(item.id); }}><Trash2 size={16} /></Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
