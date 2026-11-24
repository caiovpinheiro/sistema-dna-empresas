import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "../lib/api";
import { Janela, useCadastroNaUrl } from "../components/janela";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Empty, Field, Input, Select, Skeleton, cn } from "../components/ui";

/** Horário de um dia de trabalho. Sem pausa, saída e retorno da refeição ficam vazios. */
export type Horario = { entrada: string; saida: string; pausa: boolean; saidaRefeicao: string; retornoRefeicao: string; tolerancia?: string };
export type Jornada = {
  id: number;
  nome: string;
  /** "1" estágio, "2" CLT, "" nas escalas antigas. */
  modalidade: string;
  dias: Array<{ dia: string; rotulo: string; trabalha: boolean; horario: Horario | null }>;
  completa: boolean;
  resumo: string;
  colaboradores: number;
};

export const CHAVE_JORNADAS = ["/api/v1/empresa/jornadas"];

export function useJornadas() {
  return useQuery({ queryKey: CHAVE_JORNADAS, queryFn: () => api<Jornada[]>("/api/v1/empresa/jornadas") });
}

const DIAS = [
  ["segunda", "Segunda"], ["terca", "Terça"], ["quarta", "Quarta"], ["quinta", "Quinta"], ["sexta", "Sexta"], ["sabado", "Sábado"], ["domingo", "Domingo"],
] as const;
type Dia = (typeof DIAS)[number][0];
type DiaForm = Horario & { trabalha: boolean };

/** Horário padrão de cada modalidade: CLT 8h com 1h de almoço (40h na semana); estágio 6h corridas (30h na semana). */
const PADRAO: Record<string, DiaForm> = {
  "2": { trabalha: true, entrada: "08:00", saida: "17:00", pausa: true, saidaRefeicao: "12:00", retornoRefeicao: "13:00" },
  "1": { trabalha: true, entrada: "08:00", saida: "14:00", pausa: false, saidaRefeicao: "", retornoRefeicao: "" },
};

export const MODALIDADES = [{ valor: "2", rotulo: "CLT" }, { valor: "1", rotulo: "Estágio" }];
export const nomeModalidade = (valor: string) => MODALIDADES.find((item) => item.valor === valor)?.rotulo ?? "";

function estadoInicial(modalidade: string, jornada?: Jornada): Record<Dia, DiaForm> {
  const padrao = PADRAO[modalidade] ?? PADRAO["2"];
  return Object.fromEntries(DIAS.map(([chave]) => {
    const dia = jornada?.dias.find((item) => item.dia === chave);
    if (!jornada) return [chave, { ...padrao, trabalha: chave !== "sabado" && chave !== "domingo" }];
    // Dia de folga (ou escala antiga sem horário) abre com o horário padrão, para só marcar "trabalha" se quiser.
    return [chave, { ...padrao, ...(dia?.horario ?? {}), trabalha: Boolean(dia?.trabalha) }];
  })) as Record<Dia, DiaForm>;
}

const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
const entre = (inicio: string, fim: string) => {
  const total = minutos(fim) - minutos(inicio);
  return total < 0 ? total + 24 * 60 : total;
};
const horas = (total: number) => `${Math.floor(total / 60)}h${total % 60 ? `${String(total % 60).padStart(2, "0")}m` : ""}`;

/**
 * As mesmas regras da lei que o servidor confere (erro não deixa salvar; aviso depende de acordo ou convenção):
 * estágio até 6h/dia e 30h/semana (Lei 11.788, art. 10); CLT até 44h/semana, mais de 8h no dia só com compensação e
 * nunca acima de 10h, intervalo de 1h acima de 6h (30 min com convenção), 15 min entre 4h e 6h, uma folga na semana.
 */
function regrasDaLei(modalidade: string, dias: Record<Dia, DiaForm>) {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (modalidade !== "1" && modalidade !== "2") return { erros, avisos, semana: 0 };
  let semana = 0;
  for (const [chave, rotulo] of DIAS) {
    const dia = dias[chave];
    if (!dia.trabalha || !dia.entrada || !dia.saida) continue;
    const intervalo = dia.pausa && dia.saidaRefeicao && dia.retornoRefeicao ? entre(dia.saidaRefeicao, dia.retornoRefeicao) : 0;
    const trabalhado = entre(dia.entrada, dia.saida) - intervalo;
    semana += trabalhado;
    if (modalidade === "1") {
      if (trabalhado > 360) erros.push(`${rotulo}: ${horas(trabalhado)} de trabalho. Estágio pode ter no máximo 6 horas por dia (Lei 11.788/2008, art. 10).`);
      continue;
    }
    if (trabalhado > 600) erros.push(`${rotulo}: ${horas(trabalhado)} de trabalho. Pela CLT o dia não pode passar de 10 horas (art. 59).`);
    else if (trabalhado > 480) avisos.push(`${rotulo}: ${horas(trabalhado)} de trabalho. Mais de 8 horas no dia só vale com acordo de compensação de horas (CLT, art. 59, §2º).`);
    if (trabalhado > 360 && intervalo < 30) erros.push(`${rotulo}: mais de 6 horas de trabalho exigem pelo menos 1 hora de intervalo para refeição (CLT, art. 71).`);
    else if (trabalhado > 360 && intervalo < 60) avisos.push(`${rotulo}: intervalo menor que 1 hora só vale se a convenção ou o acordo coletivo permitir (CLT, art. 611-A, III).`);
    else if (trabalhado > 240 && trabalhado <= 360 && intervalo < 15) avisos.push(`${rotulo}: entre 4 e 6 horas de trabalho, a lei exige 15 minutos de intervalo (CLT, art. 71, §1º).`);
  }
  if (modalidade === "1" && semana > 1800) erros.push(`${horas(semana)} por semana. Estágio pode ter no máximo 30 horas semanais (Lei 11.788/2008, art. 10).`);
  if (modalidade === "2" && semana > 2640) erros.push(`${horas(semana)} por semana. Pela CLT o máximo é 44 horas semanais (Constituição, art. 7º, XIII).`);
  if (modalidade === "2" && DIAS.every(([chave]) => dias[chave].trabalha)) erros.push("Sem nenhum dia de folga. A pessoa precisa de um descanso semanal de 24 horas (CLT, art. 67).");
  return { erros, avisos, semana };
}

/** Jornadas de trabalho: em que dias a pessoa trabalha e o horário de cada dia, num cadastro só. */
export function JornadasPage() {
  const jornadas = useJornadas();
  const [novaAberta, abrirNova, fecharNova] = useCadastroNaUrl();
  const [editando, setEditando] = useState<Jornada | null>(null);
  const lista = jornadas.data?.data ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Jornadas de trabalho"
        descricao="Os dias em que a pessoa trabalha e o horário de cada dia. Cada colaborador segue uma jornada."
        acoes={<Button onClick={abrirNova}><Plus size={16} /> Nova jornada</Button>}
      />
      {jornadas.isLoading ? <Skeleton className="h-40" /> : null}
      {jornadas.isError ? <Alerta>{jornadas.error instanceof ApiError ? jornadas.error.message : "Não foi possível carregar as jornadas."}</Alerta> : null}
      {!jornadas.isLoading && !jornadas.isError && !lista.length ? (
        <Empty titulo="Nenhuma jornada ainda" texto="Cadastre a primeira, por exemplo: segunda a sexta, das 8h às 17h, com uma hora de almoço." acao={<Button onClick={abrirNova}><Plus size={16} /> Nova jornada</Button>} />
      ) : null}
      <div className="grid gap-3">
        {lista.map((jornada) => <LinhaJornada key={jornada.id} jornada={jornada} onEditar={() => setEditando(jornada)} />)}
      </div>
      <Janela larga titulo="Nova jornada" descricao="Marque os dias de trabalho e o horário de cada um." aberta={novaAberta} onFechar={fecharNova}>
        <JornadaForm aoFechar={fecharNova} />
      </Janela>
      <Janela larga titulo={`Editar ${editando?.nome ?? "jornada"}`} descricao="Quem usa esta jornada passa a seguir o horário novo. As batidas já feitas não mudam." aberta={Boolean(editando)} onFechar={() => setEditando(null)}>
        {editando ? <JornadaForm jornada={editando} aoFechar={() => setEditando(null)} /> : null}
      </Janela>
    </div>
  );
}

function LinhaJornada({ jornada, onEditar }: { jornada: Jornada; onEditar: () => void }) {
  const client = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const excluir = useMutation({
    mutationFn: () => api(`/api/v1/empresa/jornadas/${jornada.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmando(false);
      await client.invalidateQueries({ queryKey: CHAVE_JORNADAS });
    },
  });
  return (
    <Card className="grid gap-2 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-ink">{jornada.nome}</h2>
            {jornada.modalidade ? <Badge value={nomeModalidade(jornada.modalidade)}>{nomeModalidade(jornada.modalidade)}</Badge> : <Badge value="pendente">Sem modalidade</Badge>}
            {jornada.completa ? null : <Badge value="pendente">Sem horário em algum dia</Badge>}
          </div>
          <p className="text-sm tabular-nums text-slate-600">{jornada.resumo || "Nenhum dia de trabalho"}</p>
          <p className="text-xs text-slate-500">
            {jornada.colaboradores === 1 ? "1 colaborador" : `${jornada.colaboradores} colaboradores`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {confirmando ? (
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label={`Confirmar apagar ${jornada.nome}`}>
              <span className="text-sm font-semibold text-ink">Apagar?</span>
              <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={excluir.isPending}>Voltar</Button>
              <Button variant="danger" onClick={() => excluir.mutate()} disabled={excluir.isPending}>{excluir.isPending ? "Apagando…" : "Apagar"}</Button>
            </span>
          ) : (
            <>
              <Button variant="secondary" onClick={onEditar}><Pencil size={15} /> {jornada.completa && jornada.modalidade ? "Editar" : "Completar"}</Button>
              <Button variant="ghost" className="text-slate-500 hover:text-red-700" aria-label={`Apagar ${jornada.nome}`} onClick={() => { excluir.reset(); setConfirmando(true); }}><Trash2 size={16} /></Button>
            </>
          )}
        </div>
      </div>
      {excluir.error ? <Alerta>{excluir.error instanceof ApiError ? excluir.error.message : "Não foi possível apagar."}</Alerta> : null}
    </Card>
  );
}

/** Cadastro e edição da jornada: nome, tolerância e, para cada dia, se trabalha e o horário. */
export function JornadaForm({ jornada, aoFechar }: { jornada?: Jornada; aoFechar: () => void }) {
  const client = useQueryClient();
  const [nome, setNome] = useState(jornada?.nome ?? "");
  const [modalidade, setModalidade] = useState(jornada?.modalidade ?? "");
  const [dias, setDias] = useState(() => estadoInicial(jornada?.modalidade || "2", jornada));
  // Jornada nova: ao escolher a modalidade, os horários vão para o padrão dela (dá para ajustar depois).
  const trocarModalidade = (valor: string) => {
    setModalidade(valor);
    if (!jornada && PADRAO[valor]) setDias(estadoInicial(valor));
  };
  const lei = regrasDaLei(modalidade, dias);
  const [erro, setErro] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const mudar = (dia: Dia, parte: Partial<DiaForm>) => setDias((atual) => ({ ...atual, [dia]: { ...atual[dia], ...parte } }));
  const primeiroDia = DIAS.find(([chave]) => dias[chave].trabalha)?.[0];
  const copiarParaTodos = () => {
    if (!primeiroDia) return;
    const modelo = dias[primeiroDia];
    setDias((atual) => Object.fromEntries(DIAS.map(([chave]) => [chave, atual[chave].trabalha ? { ...modelo, trabalha: true } : atual[chave]])) as Record<Dia, DiaForm>);
  };
  const salvar = useMutation({
    mutationFn: () => {
      const corpo: Record<string, string> = { nome, modalidade };
      for (const [chave] of DIAS) {
        const dia = dias[chave];
        corpo[chave] = dia.trabalha ? "1" : "0";
        corpo[`${chave}_entrada`] = dia.entrada;
        corpo[`${chave}_saida`] = dia.saida;
        corpo[`${chave}_pausa`] = dia.pausa ? "1" : "0";
        corpo[`${chave}_saida_refeicao`] = dia.saidaRefeicao;
        corpo[`${chave}_retorno_refeicao`] = dia.retornoRefeicao;
      }
      return api(jornada ? `/api/v1/empresa/jornadas/${jornada.id}` : "/api/v1/empresa/jornadas", { method: jornada ? "PUT" : "POST", body: JSON.stringify(corpo) });
    },
    onSuccess: async () => {
      await client.invalidateQueries();
      aoFechar();
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.message : "Não foi possível salvar a jornada.");
      setCampos(error instanceof ApiError ? error.campos ?? {} : {});
    },
  });
  const comErro = (chave: string) => (campos[chave] ? "border-rose-400 ring-2 ring-rose-200" : "");
  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setErro(""); setCampos({}); salvar.mutate(); }}>
      <Card className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] md:p-5">
        <Field label="Nome da jornada" dica="obrigatório" erro={campos.nome}>
          <Input value={nome} required placeholder="Ex.: Comercial seg a sex" onChange={(event) => setNome(event.target.value)} />
        </Field>
        <Field label="Modalidade" dica="obrigatório" erro={campos.modalidade}>
          <Select aria-label="Modalidade" required value={modalidade} onChange={(event) => trocarModalidade(event.target.value)}>
            <option value="">Selecione</option>
            {MODALIDADES.map((item) => <option key={item.valor} value={item.valor}>{item.rotulo}</option>)}
          </Select>
        </Field>
        {/* A tolerância é a da lei, igual para todos, por isso não se escolhe. Vale também para estágio. */}
        <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
          <strong className="font-semibold text-slate-600">Tolerância da lei:</strong> se a pessoa bater até 5 minutos antes ou depois do horário em cada
          marcação, somando no máximo 10 minutos no dia, o dia não conta hora a menos nem hora extra. O ponto guarda o horário real
          que ela bateu. Passou disso, conta a diferença inteira (CLT, art. 58, §1º).
        </p>
      </Card>
      <Card className="grid gap-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 md:px-5">
          <h3 className="text-sm font-extrabold text-ink">Dias e horários</h3>
          <Button type="button" variant="ghost" className="text-violet-700" onClick={copiarParaTodos} disabled={!primeiroDia}>
            <CopyCheck size={16} /> Usar o horário do primeiro dia em todos
          </Button>
        </div>
        <ul className="divide-y divide-slate-100">
          {DIAS.map(([chave, rotulo]) => {
            const dia = dias[chave];
            return (
              <li key={chave} className={cn("grid gap-3 px-4 py-3 md:grid-cols-[9rem_minmax(0,1fr)] md:items-center md:px-5", dia.trabalha ? "" : "bg-slate-50/70")}>
                <label className="flex items-center gap-2.5 text-sm font-semibold text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={dia.trabalha} onChange={(event) => mudar(chave, { trabalha: event.target.checked })} />
                  {rotulo}
                </label>
                {dia.trabalha ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))_auto_repeat(2,minmax(0,1fr))] sm:items-end">
                    <Field label="Entrada"><Input type="time" aria-label={`Entrada de ${rotulo}`} className={comErro(`${chave}_entrada`)} value={dia.entrada} onChange={(event) => mudar(chave, { entrada: event.target.value })} /></Field>
                    <Field label="Saída"><Input type="time" aria-label={`Saída de ${rotulo}`} className={comErro(`${chave}_saida`)} value={dia.saida} onChange={(event) => mudar(chave, { saida: event.target.value })} /></Field>
                    <label className="col-span-2 flex h-10 items-center gap-2 whitespace-nowrap text-sm text-slate-700 sm:col-span-1">
                      <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={dia.pausa} onChange={(event) => mudar(chave, { pausa: event.target.checked })} />
                      Pausa para refeição
                    </label>
                    {dia.pausa ? (
                      <>
                        <Field label="Sai para refeição"><Input type="time" aria-label={`Saída para refeição de ${rotulo}`} className={comErro(`${chave}_saida_refeicao`)} value={dia.saidaRefeicao} onChange={(event) => mudar(chave, { saidaRefeicao: event.target.value })} /></Field>
                        <Field label="Volta da refeição"><Input type="time" aria-label={`Volta da refeição de ${rotulo}`} className={comErro(`${chave}_retorno_refeicao`)} value={dia.retornoRefeicao} onChange={(event) => mudar(chave, { retornoRefeicao: event.target.value })} /></Field>
                      </>
                    ) : null}
                  </div>
                ) : <p className="text-sm text-slate-500">Folga</p>}
              </li>
            );
          })}
        </ul>
      </Card>
      {modalidade && lei.semana ? (
        <p className="text-sm text-slate-600">
          Total na semana: <strong className="tabular-nums text-ink">{horas(lei.semana)}</strong>
          {modalidade === "1" ? " (estágio: até 30h)" : " (CLT: até 44h)"}
        </p>
      ) : null}
      {lei.erros.length ? (
        <div className="grid gap-1 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          <strong>A lei não permite assim:</strong>
          <ul className="list-disc pl-5">{lei.erros.map((texto) => <li key={texto}>{texto}</li>)}</ul>
        </div>
      ) : null}
      {lei.avisos.length ? (
        <div className="grid gap-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <strong>Atenção:</strong>
          <ul className="list-disc pl-5">{lei.avisos.map((texto) => <li key={texto}>{texto}</li>)}</ul>
        </div>
      ) : null}
      {erro && !lei.erros.length ? <Alerta>{campos.dias ?? erro}</Alerta> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={salvar.isPending || lei.erros.length > 0}>{salvar.isPending ? "Salvando…" : "Salvar jornada"}</Button>
        <Button type="button" variant="secondary" onClick={aoFechar}>Cancelar</Button>
      </div>
    </form>
  );
}
