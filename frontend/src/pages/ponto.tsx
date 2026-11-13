import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr } from "../lib/formato";
import { Alerta, Button, CabecalhoPagina, Card, Empty, Field, Input, Resumo, Select, Skeleton, botao, cn } from "../components/ui";
import { CampoBusca, Consulta, TabelaLinhas } from "./consultas";

type Linha = Record<string, string | number | null>;

export function Listagem({ titulo, descricao, caminho, novo, rotuloNovo = "Cadastrar", colunas, linkNome, linkColuna = "nome", singular = "registro", plural = "registros" }: {
  titulo: string;
  descricao?: string;
  caminho: string;
  novo?: string;
  rotuloNovo?: string;
  colunas: Array<{ chave: string; titulo: string }>;
  linkNome?: (linha: Linha) => string | null;
  linkColuna?: string;
  singular?: string;
  plural?: string;
}) {
  const lista = useQuery({ queryKey: [caminho], queryFn: () => api<Linha[]>(caminho) });
  const [texto, setTexto] = useState("");
  const todas = Array.isArray(lista.data?.data) ? lista.data.data : [];
  const termo = texto.trim().toLowerCase();
  const linhas = termo ? todas.filter((linha) => colunas.some((coluna) => String(linha[coluna.chave] ?? "").toLowerCase().includes(termo))) : todas;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina titulo={titulo} descricao={descricao} acoes={novo ? <RouterLink to={novo} className={botao("primary", "botao")}><Plus size={16} /> {rotuloNovo}</RouterLink> : null} />
      {todas.length > 5 ? <Card><CampoBusca valor={texto} onChange={setTexto} placeholder="Filtrar nesta lista" /></Card> : null}
      {!lista.isError ? <Resumo total={linhas.length} singular={singular} plural={plural} carregando={lista.isLoading} /> : null}
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar esta lista."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-56" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? (
        <Empty titulo={termo ? "Nada encontrado" : "Nenhum registro ainda"} texto={termo ? "Confira a grafia ou limpe o filtro." : "Assim que houver registros desta empresa, eles aparecem aqui."} acao={!termo && novo ? <RouterLink to={novo} className={botao("primary", "botao")}><Plus size={16} /> {rotuloNovo}</RouterLink> : null} />
      ) : null}
      {linhas.length ? <TabelaLinhas linhas={linhas} colunas={colunas} linkNome={linkNome} linkColuna={linkColuna} /> : null}
    </div>
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

export function RelatorioPonto() {
  return <Listagem titulo="Cartão ponto" descricao="Últimas batidas dos colaboradores. Clique no nome para ver o relatório completo da pessoa." singular="batida" plural="batidas" caminho="/api/v1/empresa/ponto/relatorio" linkNome={(linha) => linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null} colunas={[
    { chave: "nome", titulo: "Colaborador" }, { chave: "data", titulo: "Data" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida", titulo: "Saída" }, { chave: "horas", titulo: "Horas" },
  ]} />;
}

type DiaPonto = { data: string; dia: string; situacao: string; entrada1: string; saida1: string; entrada2: string; saida2: string; total: string; carga: string; saldo: string; saldoNegativo: boolean; banco: string; bancoNegativo: boolean };
type RelatorioPessoa = { nome: string; cargo: string; bancoHoras: boolean; semRegistro?: boolean; de?: string; ate?: string; dias: DiaPonto[] };

export function ColaboradoresPonto() {
  return <Consulta
    titulo="Ponto por colaborador"
    descricao="Escolha a pessoa para ver as batidas, o saldo do dia e o banco de horas."
    caminho="/api/v1/empresa/colaboradores"
    filtroStatus
    singular="colaborador"
    plural="colaboradores"
    linkNome={(linha) => linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null}
    colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "datainicio", titulo: "Contratação" }, { chave: "departamento", titulo: "Departamento" }, { chave: "cargo", titulo: "Cargo" }, { chave: "modalidade", titulo: "Modalidade" }, { chave: "situacao", titulo: "Situação" }]}
  />;
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <RouterLink to="/ponto/colaboradores" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Ponto por colaborador</RouterLink>
      <CabecalhoPagina titulo={pessoa?.nome || "Relatório de ponto"} descricao={[pessoa?.cargo, pessoa?.bancoHoras ? "Com banco de horas" : null].filter(Boolean).join(" · ") || "Batidas, saldo do dia e banco de horas."} />
      <Card>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setPeriodo({ de, ate }); }}>
          <Field label="De" className="w-full sm:w-44"><Input type="date" value={de} onChange={(event) => setDe(event.target.value)} /></Field>
          <Field label="Até" className="w-full sm:w-44"><Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} /></Field>
          <Button type="submit" className="h-10"><Search size={16} /> Pesquisar</Button>
        </form>
      </Card>
      {relatorio.isLoading ? <Skeleton className="h-72" /> : null}
      {relatorio.isError ? <Alerta>{relatorio.error instanceof ApiError ? relatorio.error.message : "Não foi possível carregar o relatório."}</Alerta> : null}
      {pessoa?.semRegistro ? <Empty titulo="Sem cadastro de ponto" texto="Esta pessoa ainda não tem cadastro de ponto nesta empresa." /> : null}
      {pessoa && !pessoa.semRegistro ? (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  {["Data", "Dia", "Ent. 1", "Saí. 1", "Ent. 2", "Saí. 2", "Total", "Carga", "Saldo", "B. Horas"].map((titulo) => <th key={titulo}>{titulo}</th>)}
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.data}>
                    <td className="whitespace-nowrap tabular-nums">{dataBr(dia.data)}</td>
                    <td className="text-slate-500">{dia.dia}</td>
                    <td className={cn("tabular-nums", dia.situacao ? "font-semibold text-amber-700" : "")}>{dia.situacao || dia.entrada1 || "—"}</td>
                    <td className="tabular-nums">{dia.saida1 || "—"}</td>
                    <td className="tabular-nums">{dia.entrada2 || "—"}</td>
                    <td className="tabular-nums">{dia.saida2 || "—"}</td>
                    <td className="font-semibold tabular-nums">{dia.total}</td>
                    <td className="tabular-nums text-slate-500">{dia.carga}</td>
                    <td className={cn("font-semibold tabular-nums", dia.saldoNegativo ? "text-rose-700" : "text-emerald-700")}>{dia.saldo}</td>
                    <td className={cn("tabular-nums", dia.bancoNegativo ? "text-rose-700" : "")}>{dia.banco || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!relatorio.isLoading && !relatorio.isError && dias.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">Nenhum dia neste período.</p> : null}
        </Card>
      ) : null}
    </div>
  );
}

export function Formulario({ titulo, descricao, destino, voltar, campos, extra = {} }: {
  titulo: string;
  descricao?: string;
  destino: string;
  voltar: string;
  extra?: Record<string, string>;
  campos: Array<[string, string, string, Array<{ valor: string; rotulo: string }>?]>;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [camposErro, setCamposErro] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const client = useQueryClient();
  const salvar = useMutation({
    mutationFn: () => api(destino, { method: "POST", body: JSON.stringify({ ...extra, ...valores }) }),
    onSuccess: async () => {
      await client.invalidateQueries();
      navigate(voltar);
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.message : "Não foi possível salvar.");
      setCamposErro(error instanceof ApiError && error.campos ? error.campos : {});
    },
  });
  const obrigatorio = (chave: string, tipo: string) => tipo !== "time" && tipo !== "select" && !["email", "celular", "departamento", "salario", "cidade", "tolerancia"].includes(chave);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <RouterLink to={voltar} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Voltar</RouterLink>
      <CabecalhoPagina titulo={titulo} descricao={descricao ?? "Os campos marcados como obrigatórios precisam ser preenchidos."} />
      <form className="grid max-w-3xl gap-5" onSubmit={(event) => { event.preventDefault(); setErro(""); salvar.mutate(); }}>
        <Card className="grid gap-4 md:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map(([chave, rotulo, tipo, opcoes]) => (
              <Field key={chave} label={rotulo} dica={obrigatorio(chave, tipo) ? "obrigatório" : undefined} erro={camposErro[chave]}>
                {tipo === "select" ? (
                  <Select value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })}>
                    <option value="">Selecione</option>
                    {(opcoes ?? []).map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                  </Select>
                ) : (
                  <Input required={obrigatorio(chave, tipo)} type={tipo} value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })} />
                )}
              </Field>
            ))}
          </div>
          {erro ? <Alerta>{erro}</Alerta> : null}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar"}</Button>
            <Button type="button" variant="secondary" onClick={() => navigate(voltar)}>Cancelar</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
