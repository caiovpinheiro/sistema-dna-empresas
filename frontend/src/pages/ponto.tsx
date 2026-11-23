import { useEffect, useState, type ReactNode } from "react";
import { Janela, useCadastroNaUrl } from "../components/janela";
import { ApagarColaborador, ConfiguracaoPonto } from "./ponto-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr } from "../lib/formato";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Empty, Field, Input, Resumo, Select, Skeleton, botao, cn } from "../components/ui";
import { CampoBusca, Consulta, TabelaLinhas } from "./consultas";

type Linha = Record<string, string | number | null>;

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Cadastro que abre numa janela por cima da lista, em vez de ir para outra página. */
type CadastroEmJanela = { titulo: string; descricao?: string; formulario: (fechar: () => void) => ReactNode };
/** Apagar pela lista: rota DELETE de cada linha. A confirmação fica na própria linha; o erro (ex.: em uso) aparece acima da lista. */
type ExcluirNaLista = { caminho: (linha: Linha) => string | null; nome: (linha: Linha) => string };

function ExcluirLinha({ caminho, nome, onErro }: { caminho: string; nome: string; onErro: (mensagem: string) => void }) {
  const client = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const excluir = useMutation({
    mutationFn: () => api(caminho, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmando(false);
      await client.invalidateQueries();
    },
    onError: (error) => {
      setConfirmando(false);
      onErro(error instanceof ApiError ? error.message : "Não foi possível apagar.");
    },
  });
  if (!confirmando) {
    return (
      <Button variant="ghost" className="px-2 py-1 text-slate-500 hover:text-red-700" aria-label={`Apagar ${nome}`} title="Apagar" onClick={() => { onErro(""); setConfirmando(true); }}>
        <Trash2 size={16} />
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={`Confirmar apagar ${nome}`}>
      <span className="text-xs font-semibold text-ink">Apagar?</span>
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirmando(false)} disabled={excluir.isPending}>Voltar</Button>
      <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => excluir.mutate()} disabled={excluir.isPending}>{excluir.isPending ? "Apagando…" : "Apagar"}</Button>
    </span>
  );
}

export function Listagem({ titulo, descricao, caminho, novo, rotuloNovo = "Cadastrar", colunas, linkNome, linkColuna = "nome", singular = "registro", plural = "registros", cadastro, excluir }: {
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
  cadastro?: CadastroEmJanela;
  excluir?: ExcluirNaLista;
}) {
  const [janela, abrirJanela, fecharJanela] = useCadastroNaUrl();
  const [erroExcluir, setErroExcluir] = useState("");
  const lista = useQuery({ queryKey: [caminho], queryFn: () => api<Linha[]>(caminho) });
  const [texto, setTexto] = useState("");
  const todas = Array.isArray(lista.data?.data) ? lista.data.data : [];
  const termo = texto.trim().toLowerCase();
  const linhas = termo ? todas.filter((linha) => colunas.some((coluna) => String(linha[coluna.chave] ?? "").toLowerCase().includes(termo))) : todas;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo={titulo}
        descricao={descricao}
        acoes={cadastro
          ? <Button onClick={abrirJanela}><Plus size={16} /> {rotuloNovo}</Button>
          : novo ? <RouterLink to={novo} className={botao("primary", "botao")}><Plus size={16} /> {rotuloNovo}</RouterLink> : null}
      />
      {cadastro ? (
        <Janela titulo={cadastro.titulo} descricao={cadastro.descricao} aberta={janela} onFechar={fecharJanela}>
          {cadastro.formulario(fecharJanela)}
        </Janela>
      ) : null}
      {todas.length > 5 ? <Card><CampoBusca valor={texto} onChange={setTexto} placeholder="Filtrar nesta lista" /></Card> : null}
      {!lista.isError ? <Resumo total={linhas.length} singular={singular} plural={plural} carregando={lista.isLoading} /> : null}
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar esta lista."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-56" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? (
        <Empty titulo={termo ? "Nada encontrado" : "Nenhum registro ainda"} texto={termo ? "Confira a grafia ou limpe o filtro." : "Assim que houver registros desta empresa, eles aparecem aqui."} acao={!termo && novo ? <RouterLink to={novo} className={botao("primary", "botao")}><Plus size={16} /> {rotuloNovo}</RouterLink> : null} />
      ) : null}
      {erroExcluir ? <Alerta>{erroExcluir}</Alerta> : null}
      {linhas.length ? (
        <TabelaLinhas
          linhas={linhas}
          colunas={colunas}
          linkNome={linkNome}
          linkColuna={linkColuna}
          acao={excluir ? (linha) => {
            const destino = excluir.caminho(linha);
            return destino ? <ExcluirLinha key={destino} caminho={destino} nome={excluir.nome(linha)} onErro={setErroExcluir} /> : null;
          } : undefined}
        />
      ) : null}
    </div>
  );
}

/** Com `reativar`, abre preenchido com os dados da pessoa desligada e cria uma passagem nova (começa do zero). */
export function ColaboradorNovo({ aoFechar, iniciais, reativar = false }: { aoFechar?: () => void; iniciais?: Record<string, string>; reativar?: boolean } = {}) {
  return <Formulario aoFechar={aoFechar} iniciais={iniciais} extra={reativar ? { reativar: "1" } : {}} titulo="Cadastrar colaborador" destino="/api/v1/empresa/colaboradores" voltar="/colaboradores" campos={[
    ["nome", "Nome", "text"], ["cpf", "CPF", "text"], ["email", "E-mail", "email"], ["celular", "Celular", "text"],
    ["cargo", "Cargo", "text"], ["departamento", "Departamento", "text"],
    ["modalidade", "Modalidade", "select", [{ valor: "2", rotulo: "CLT" }, { valor: "1", rotulo: "Estágio" }]],
    ["inicio", "Início", "date"],
  ]} />;
}

/**
 * Escala = quais dias da semana a pessoa trabalha (dna_work.ponto_turno_base guarda 1 trabalha / 0 folga por dia).
 * O horário de cada dia vem da carga horária, ligada ao colaborador.
 */
const TRABALHA_FOLGA = [{ valor: "1", rotulo: "Trabalha" }, { valor: "0", rotulo: "Folga" }];
const DIAS_ESCALA: Array<[string, string]> = [
  ["segunda", "Segunda"], ["terca", "Terça"], ["quarta", "Quarta"], ["quinta", "Quinta"], ["sexta", "Sexta"], ["sabado", "Sábado"], ["domingo", "Domingo"],
];

export function EscalaNova({ aoFechar }: { aoFechar?: () => void } = {}) {
  return <Formulario aoFechar={aoFechar}
    titulo="Cadastrar escala"
    descricao="Marque os dias em que a pessoa trabalha. O horário de cada dia vem da carga horária."
    destino="/api/v1/empresa/escalas"
    voltar="/escalas"
    iniciais={{ segunda: "1", terca: "1", quarta: "1", quinta: "1", sexta: "1", sabado: "0", domingo: "0" }}
    semSelecione={DIAS_ESCALA.map(([chave]) => chave)}
    campos={[["nome", "Nome", "text"], ...DIAS_ESCALA.map(([chave, rotulo]) => [chave, rotulo, "select", TRABALHA_FOLGA] as [string, string, string, typeof TRABALHA_FOLGA])]}
  />;
}

export function CargaNova({ aoFechar }: { aoFechar?: () => void } = {}) {
  return <Formulario aoFechar={aoFechar} titulo="Cadastrar carga horária" destino="/api/v1/empresa/cargas" voltar="/cargas" campos={[
    // Diurno ou noturno não é escolhido aqui: o servidor calcula pelo horário (passa da meia-noite ou maior parte entre 22h e 5h).
    ["nome", "Nome", "text"],
    ["entrada", "Entrada", "time"], ["pausa", "Pausa para refeição", "select", [{ valor: "1", rotulo: "Sim" }, { valor: "0", rotulo: "Não" }]],
    // Com "Não", os horários de refeição somem; com "Sim" ou nada escolhido, aparecem.
    ["saidaRefeicao", "Saída refeição", "time", undefined, (valores) => valores.pausa !== "0"],
    ["retornoRefeicao", "Retorno refeição", "time", undefined, (valores) => valores.pausa !== "0"],
    ["saida", "Saída", "time"], ["tolerancia", "Tolerância (min)", "text"],
  ]} />;
}

export function FeriadoNovo({ aoFechar }: { aoFechar?: () => void } = {}) {
  return <Formulario aoFechar={aoFechar}
    titulo="Cadastrar feriado"
    descricao="Os feriados nacionais já entram sozinhos. Aqui ficam os da sua cidade, do seu estado e os dias de folga da empresa."
    destino="/api/v1/empresa/feriados"
    voltar="/feriados"
    iniciais={{ abrangencia: "municipal", fixo: "1", facultativo: "0" }}
    semSelecione={["abrangencia", "fixo", "facultativo"]}
    campos={[
      ["nome", "Nome", "text"],
      ["data", "Data", "date"],
      ["abrangencia", "Abrangência", "select", [
        { valor: "municipal", rotulo: "Municipal (cidade da empresa)" },
        { valor: "estadual", rotulo: "Estadual (UF da empresa)" },
        { valor: "empresa", rotulo: "Só da empresa" },
      ]],
      ["fixo", "Repete todo ano", "select", [{ valor: "1", rotulo: "Sim, mesmo dia todo ano" }, { valor: "0", rotulo: "Não, só nesta data" }]],
      ["facultativo", "Ponto facultativo", "select", [{ valor: "0", rotulo: "Não, é feriado" }, { valor: "1", rotulo: "Sim, ponto facultativo" }]],
    ]}
  />;
}

export function RelatorioPonto() {
  return <Listagem titulo="Cartão ponto" descricao="Últimas batidas dos colaboradores. Clique no nome para ver o relatório completo da pessoa." singular="batida" plural="batidas" caminho="/api/v1/empresa/ponto/relatorio" linkNome={(linha) => linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null} colunas={[
    { chave: "nome", titulo: "Colaborador" }, { chave: "data", titulo: "Data" }, { chave: "entrada", titulo: "Entrada" }, { chave: "saida", titulo: "Saída" }, { chave: "horas", titulo: "Horas" },
  ]} />;
}

type DiaPonto = { data: string; dia: string; anterior?: boolean; situacao: string; entrada1: string; saida1: string; entrada2: string; saida2: string; total: string; carga: string; saldo: string; saldoNegativo: boolean; banco: string; bancoNegativo: boolean };
type RelatorioPessoa = {
  nome: string; cargo: string; bancoHoras: boolean; semRegistro?: boolean; estagio?: boolean; desligado?: boolean;
  inicioContrato?: string; temAnterior?: boolean; cadastro?: Record<string, string>;
  de?: string; ate?: string; dias: DiaPonto[];
};

export function ColaboradoresPonto() {
  const [janela, abrirJanela, fecharJanela] = useCadastroNaUrl();
  return (
    <>
      <Consulta
        titulo="Colaboradores"
        descricao="Escolha a pessoa para ver as batidas, o saldo do dia e o banco de horas."
        caminho="/api/v1/empresa/ponto/colaboradores"
        filtroStatus
        rotuloInativos="Desligados"
        singular="colaborador"
        plural="colaboradores"
        acoes={<Button onClick={abrirJanela}><Plus size={16} /> Cadastrar colaborador</Button>}
        linkNome={(linha) => linha.id_candidato ? `/ponto/colaborador/${linha.id_candidato}` : null}
        colunas={[{ chave: "nome", titulo: "Colaborador" }, { chave: "datainicio", titulo: "Início" }, { chave: "cargo", titulo: "Cargo" }, { chave: "modalidade", titulo: "Modalidade" }, { chave: "jornada", titulo: "Jornada" }, { chave: "situacao", titulo: "Situação" }]}
      />
      <Janela titulo="Cadastrar colaborador" descricao="Os campos marcados como obrigatórios precisam ser preenchidos." aberta={janela} onFechar={fecharJanela}>
        <ColaboradorNovo aoFechar={fecharJanela} />
      </Janela>
    </>
  );
}

export function RelatorioPontoColaborador({ id }: { id: string }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [periodo, setPeriodo] = useState<{ de?: string; ate?: string }>({});
  const [reativando, setReativando] = useState(false);
  const relatorio = useQuery({
    queryKey: ["ponto-colaborador", id, periodo.de ?? "", periodo.ate ?? ""],
    queryFn: () => api<RelatorioPessoa>(`/api/v1/empresa/ponto/colaborador/${id}?de=${periodo.de ?? ""}&ate=${periodo.ate ?? ""}`),
  });
  const pessoa = relatorio.data?.data;
  const dias = pessoa?.dias ?? [];
  const temDiaAnterior = dias.some((dia) => dia.anterior);
  useEffect(() => {
    if (!periodo.de && pessoa?.de) setDe(pessoa.de);
    if (!periodo.ate && pessoa?.ate) setAte(pessoa.ate);
  }, [pessoa?.de, pessoa?.ate, periodo.de, periodo.ate]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <RouterLink to="/ponto/colaboradores" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Colaboradores</RouterLink>
      <CabecalhoPagina titulo={pessoa?.nome || "Relatório de ponto"} descricao={[pessoa?.cargo, pessoa?.bancoHoras ? "Com banco de horas" : null].filter(Boolean).join(" · ") || "Batidas, saldo do dia e banco de horas."} acoes={pessoa && !pessoa.semRegistro ? (
        <ApagarColaborador id={id} nome={pessoa.nome || "o colaborador"} desligado={Boolean(pessoa.desligado)} aoReativar={() => setReativando(true)} />
      ) : null} />
      {pessoa && !pessoa.semRegistro ? <ConfiguracaoPonto id={id} estagio={Boolean(pessoa.estagio)} desligado={Boolean(pessoa.desligado)} /> : null}
      <Janela titulo={`Reativar ${pessoa?.nome ?? ""}`} descricao="A pessoa volta como se fosse nova: sem saldo nem banco de horas. Confira a modalidade e o início." aberta={reativando} onFechar={() => setReativando(false)}>
        <ColaboradorNovo reativar iniciais={{ ...(pessoa?.cadastro ?? {}), inicio: hojeIso() }} aoFechar={() => { setReativando(false); setPeriodo({}); setDe(""); setAte(""); }} />
      </Janela>
      <Card className="grid gap-3">
        {pessoa?.temAnterior && pessoa.inicioContrato ? (
          <p className="text-sm text-slate-500">
            Contrato atual desde <strong className="text-ink">{dataBr(pessoa.inicioContrato)}</strong>. Para ver o ponto de uma contratação anterior, escolha as datas e pesquise.
          </p>
        ) : null}
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
                  <tr key={dia.data} className={dia.anterior ? "bg-slate-50/80" : undefined}>
                    <td className="whitespace-nowrap tabular-nums">
                      {dataBr(dia.data)}
                      {dia.anterior ? <span className="ml-2 align-middle"><Badge value="Desligado">Contrato anterior</Badge></span> : null}
                    </td>
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
          {temDiaAnterior ? <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Os dias marcados são de uma contratação anterior: batidas e saldo daquela época, que não entram no saldo do contrato atual.</p> : null}
        </Card>
      ) : null}
    </div>
  );
}

/** [chave, rótulo, tipo, opções do select, quando mostrar o campo (a partir dos valores atuais)]. */
type CampoFormulario = [string, string, string, Array<{ valor: string; rotulo: string }>?, ((valores: Record<string, string>) => boolean)?];

export function Formulario({ titulo, descricao, destino, voltar, campos, extra = {}, iniciais = {}, semSelecione = [], aoFechar }: {
  titulo: string;
  descricao?: string;
  destino: string;
  voltar: string;
  extra?: Record<string, string>;
  campos: CampoFormulario[];
  /** Valores com que o formulário já abre preenchido. */
  iniciais?: Record<string, string>;
  /** Selects que não mostram a opção vazia "Selecione". */
  semSelecione?: string[];
  /** Dentro de uma janela: sem cabeçalho nem "Voltar"; salvar e cancelar fecham a janela em vez de trocar de página. */
  aoFechar?: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(iniciais);
  const [erro, setErro] = useState("");
  const [camposErro, setCamposErro] = useState<Record<string, string>>({});
  // CPF de alguém que já trabalhou aqui e foi desligado: pergunta antes de reativar.
  const [reativar, setReativar] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const salvar = useMutation({
    mutationFn: (confirmado: boolean) => api(destino, { method: "POST", body: JSON.stringify({ ...extra, ...valores, ...(confirmado ? { reativar: "1" } : {}) }) }),
    onSuccess: async () => {
      setReativar(false);
      await client.invalidateQueries();
      if (aoFechar) aoFechar();
      else navigate(voltar);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "COLABORADOR_DESLIGADO") {
        setErro("");
        setCamposErro({});
        setReativar(true);
        return;
      }
      setErro(error instanceof ApiError ? error.message : "Não foi possível salvar.");
      setCamposErro(error instanceof ApiError && error.campos ? error.campos : {});
    },
  });
  const obrigatorio = (chave: string, tipo: string) => (tipo !== "time" && tipo !== "select" && !["email", "celular", "departamento", "salario", "cidade", "tolerancia"].includes(chave)) || chave === "modalidade";
  const cancelar = () => (aoFechar ? aoFechar() : navigate(voltar));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {aoFechar ? null : (
        <>
          <RouterLink to={voltar} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Voltar</RouterLink>
          <CabecalhoPagina titulo={titulo} descricao={descricao ?? "Os campos marcados como obrigatórios precisam ser preenchidos."} />
        </>
      )}
      <form className="grid max-w-3xl gap-5" onSubmit={(event) => { event.preventDefault(); setErro(""); salvar.mutate(extra.reativar === "1"); }}>
        <Card className="grid gap-4 md:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.filter(([, , , , mostrar]) => !mostrar || mostrar(valores)).map(([chave, rotulo, tipo, opcoes]) => (
              <Field key={chave} label={rotulo} dica={obrigatorio(chave, tipo) ? "obrigatório" : undefined} erro={camposErro[chave]}>
                {tipo === "select" ? (
                  <Select aria-label={rotulo} required={obrigatorio(chave, tipo)} value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })}>
                    {semSelecione.includes(chave) ? null : <option value="">Selecione</option>}
                    {(opcoes ?? []).map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                  </Select>
                ) : (
                  <Input aria-label={rotulo} required={obrigatorio(chave, tipo)} type={tipo} value={valores[chave] ?? ""} onChange={(event) => { if (chave === "cpf") setReativar(false); setValores({ ...valores, [chave]: event.target.value }); }} />
                )}
              </Field>
            ))}
          </div>
          {erro ? <Alerta>{erro}</Alerta> : null}
          {reativar ? (
            <div className="grid gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alertdialog" aria-label="Pessoa desligada">
              <p>
                <strong>Esta pessoa já trabalhou aqui e está desligada.</strong> Quer reativar o ponto dela? Ela volta como se fosse
                nova: começa sem saldo nem banco de horas, e as batidas antigas ficam só no histórico.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => salvar.mutate(true)} disabled={salvar.isPending}>{salvar.isPending ? "Reativando…" : "Reativar ponto"}</Button>
                <Button type="button" variant="ghost" onClick={() => setReativar(false)} disabled={salvar.isPending}>Não reativar</Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar"}</Button>
            <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
