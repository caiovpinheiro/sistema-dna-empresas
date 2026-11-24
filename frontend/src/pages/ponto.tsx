import { useEffect, useState, type ReactNode } from "react";
import { Janela, useCadastroNaUrl } from "../components/janela";
import { ApagarColaborador, ConfiguracaoPonto, RedefinirSenha } from "./ponto-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { Saldo, horasMin } from "./relatorio-ponto";
import { ApiError, api } from "../lib/api";
import { dataBr } from "../lib/formato";
import { Alerta, Badge, Button, CabecalhoPagina, Card, Empty, Field, Input, Resumo, Select, Skeleton, botao, cn } from "../components/ui";
import { CampoBusca, Consulta, TabelaLinhas } from "./consultas";
import { nomeModalidade, useJornadas } from "./jornadas";
import { filtrar } from "../lib/busca";

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
  const termo = texto.trim();
  const linhas = filtrar(todas, termo, colunas.map((coluna) => coluna.chave));
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
      {todas.length > 5 ? <Card><CampoBusca valor={texto} onChange={setTexto} placeholder="Buscar nesta lista (sem precisar de acento)" /></Card> : null}
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

/**
 * Cadastro de colaborador. A jornada (dias e horários de trabalho) entra junto: sem ela o ponto trata todo dia como folga.
 * Com `reativar`, abre preenchido com os dados da pessoa desligada e cria uma passagem nova (começa do zero).
 */
export function ColaboradorNovo({ aoFechar, iniciais, reativar = false }: { aoFechar?: () => void; iniciais?: Record<string, string>; reativar?: boolean } = {}) {
  const jornadas = useJornadas();
  // A modalidade (estágio ou CLT) vem da jornada escolhida. Só entram jornadas completas: horário em todos os dias de
  // trabalho e modalidade definida (as escalas antigas precisam ser completadas antes).
  const completas = (jornadas.data?.data ?? []).filter((jornada) => jornada.completa && jornada.modalidade);
  const opcoes = completas.map((jornada) => ({ valor: String(jornada.id), rotulo: `${jornada.nome} (${nomeModalidade(jornada.modalidade)}) · ${jornada.resumo}` }));
  const semJornada = !jornadas.isLoading && !completas.length;
  return <Formulario aoFechar={aoFechar} iniciais={iniciais} extra={reativar ? { reativar: "1" } : {}} titulo="Cadastrar colaborador" destino="/api/v1/empresa/colaboradores" voltar="/colaboradores"
    aviso={semJornada ? (
      <Alerta tom="aviso">
        A empresa ainda não tem jornada de trabalho. <RouterLink className="font-bold underline" to="/jornadas?novo=1" onClick={aoFechar}>Cadastre uma jornada</RouterLink> com os dias e horários e volte aqui.
      </Alerta>
    ) : null}
    ajudas={{
      cargo: "A função da pessoa. Aparece na lista e no espelho de ponto.",
      departamento: "Opcional. O setor, para encontrar e agrupar as pessoas.",
      jornada: "Dias e horários de trabalho. A modalidade (estágio ou CLT) vem da jornada. Crie e altere em Jornadas de trabalho.",
      senha: "Senha provisória para o app do ponto (mínimo 6 caracteres). A pessoa entra com o CPF e essa senha e cria a dela no primeiro acesso.",
    }}
    campos={[
      ["nome", "Nome", "text"], ["cpf", "CPF", "text"], ["email", "E-mail", "email"], ["celular", "Celular", "text"],
      ["cargo", "Cargo", "text"], ["departamento", "Departamento", "text"],
      ["inicio", "Início", "date"],
      ["jornada", "Jornada de trabalho", "select", opcoes],
      ["senha", "Senha do primeiro acesso", "password"],
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

export { RelatorioPonto } from "./relatorio-ponto";

type ResumoPeriodo = { feitos: number; previstos: number; saldo: number; diasTrabalhados: number; faltas: number; incompletas: number; atestados: number };
type DiaPonto = { data: string; dia: string; anterior?: boolean; incompleta?: boolean; ajustado?: boolean; situacao: string; entrada1: string; saida1: string; entrada2: string; saida2: string; total: string; carga: string; saldo: string; saldoNegativo: boolean; banco: string; bancoNegativo: boolean };
type RelatorioPessoa = {
  nome: string; cargo: string; bancoHoras: boolean; semRegistro?: boolean; estagio?: boolean; desligado?: boolean;
  inicioContrato?: string; temAnterior?: boolean; cadastro?: Record<string, string>;
  periodo?: ResumoPeriodo; periodoAnterior?: ResumoPeriodo | null; total?: ResumoPeriodo | null;
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
  // Vindo do relatório do período, abre já com as mesmas datas (?de=&ate=).
  const [parametros] = useSearchParams();
  const [de, setDe] = useState(parametros.get("de") ?? "");
  const [ate, setAte] = useState(parametros.get("ate") ?? "");
  const [periodo, setPeriodo] = useState<{ de?: string; ate?: string }>(parametros.get("de") ? { de: parametros.get("de")!, ate: parametros.get("ate") ?? undefined } : {});
  const [reativando, setReativando] = useState(false);
  const relatorio = useQuery({
    queryKey: ["ponto-colaborador", id, periodo.de ?? "", periodo.ate ?? ""],
    queryFn: () => api<RelatorioPessoa>(`/api/v1/empresa/ponto/colaborador/${id}?de=${periodo.de ?? ""}&ate=${periodo.ate ?? ""}`),
  });
  const pessoa = relatorio.data?.data;
  const dias = pessoa?.dias ?? [];
  const temDiaAnterior = dias.some((dia) => dia.anterior);
  // Banco de horas gravado pelo sistema antigo: a coluna só aparece quando há valor.
  const temBanco = dias.some((dia) => dia.banco);
  useEffect(() => {
    if (!periodo.de && pessoa?.de) setDe(pessoa.de);
    if (!periodo.ate && pessoa?.ate) setAte(pessoa.ate);
  }, [pessoa?.de, pessoa?.ate, periodo.de, periodo.ate]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <RouterLink to="/ponto/colaboradores" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Colaboradores</RouterLink>
      <CabecalhoPagina titulo={pessoa?.nome || "Relatório de ponto"} descricao={[pessoa?.cargo, pessoa?.bancoHoras ? "Com banco de horas" : null].filter(Boolean).join(" · ") || "Batidas, saldo do dia e banco de horas."} acoes={pessoa && !pessoa.semRegistro ? (
        <div className="flex flex-wrap justify-end gap-2">
          {pessoa.desligado ? null : <RedefinirSenha id={id} nome={pessoa.nome || "o colaborador"} />}
          <ApagarColaborador id={id} nome={pessoa.nome || "o colaborador"} desligado={Boolean(pessoa.desligado)} aoReativar={() => setReativando(true)} />
        </div>
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
      {pessoa && !pessoa.semRegistro && pessoa.periodo ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-xs font-semibold text-slate-500">Trabalhado no período</p>
            <p className="text-xl font-extrabold tabular-nums text-ink">{horasMin(pessoa.periodo.feitos)}</p>
            <p className="text-xs text-slate-500">de {horasMin(pessoa.periodo.previstos)} previstas</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold text-slate-500">Saldo do período</p>
            <p className="text-xl"><Saldo minutos={pessoa.periodo.saldo} /></p>
            <p className="text-xs text-slate-500">{pessoa.de && pessoa.ate ? `${dataBr(pessoa.de)} a ${dataBr(pessoa.ate)}` : "Período escolhido"}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold text-slate-500">Saldo total</p>
            <p className="text-xl"><Saldo minutos={pessoa.total?.saldo} /></p>
            <p className="text-xs text-slate-500">{pessoa.inicioContrato ? `Desde ${dataBr(pessoa.inicioContrato)}, início do contrato` : "Desde o início do contrato"}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold text-slate-500">No período</p>
            <p className="text-sm text-ink">
              {pessoa.periodo.diasTrabalhados} {pessoa.periodo.diasTrabalhados === 1 ? "dia trabalhado" : "dias trabalhados"}
              {pessoa.periodo.faltas ? ` · ${pessoa.periodo.faltas} ${pessoa.periodo.faltas === 1 ? "falta" : "faltas"}` : ""}
              {pessoa.periodo.atestados ? ` · ${pessoa.periodo.atestados} ${pessoa.periodo.atestados === 1 ? "atestado" : "atestados"}` : ""}
            </p>
            {pessoa.periodo.incompletas ? <p className="text-xs font-semibold text-amber-700">{pessoa.periodo.incompletas} {pessoa.periodo.incompletas === 1 ? "batida incompleta" : "batidas incompletas"}: falta a saída</p> : null}
            {pessoa.estagio && pessoa.periodo.saldo > 0 ? <p className="text-xs font-semibold text-amber-700">Estágio acima da jornada: a Lei do Estágio não permite hora extra.</p> : null}
          </Card>
        </div>
      ) : null}
      {pessoa?.periodoAnterior ? (
        <p className="text-sm text-slate-500">Contratação anterior, no mesmo período: {horasMin(pessoa.periodoAnterior.feitos)} trabalhadas, saldo <Saldo minutos={pessoa.periodoAnterior.saldo} /> (não entra no saldo atual).</p>
      ) : null}
      {relatorio.isLoading ? <Skeleton className="h-72" /> : null}
      {relatorio.isError ? <Alerta>{relatorio.error instanceof ApiError ? relatorio.error.message : "Não foi possível carregar o relatório."}</Alerta> : null}
      {pessoa?.semRegistro ? <Empty titulo="Sem cadastro de ponto" texto="Esta pessoa ainda não tem cadastro de ponto nesta empresa." /> : null}
      {pessoa && !pessoa.semRegistro ? (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  {["Data", "Dia", "Ent. 1", "Saí. 1", "Ent. 2", "Saí. 2", "Total", "Carga", "Saldo", ...(temBanco ? ["B. Horas"] : [])].map((titulo) => <th key={titulo}>{titulo}</th>)}
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.data} className={dia.anterior ? "bg-slate-50/80" : undefined}>
                    <td className="whitespace-nowrap tabular-nums">
                      {dataBr(dia.data)}
                      {dia.anterior ? <span className="ml-2 align-middle"><Badge value="Desligado">Contrato anterior</Badge></span> : null}
                      {dia.ajustado ? <span className="ml-2 align-middle" title="Horário corrigido ou incluído por pedido aprovado. A marcação original do relógio continua guardada."><Badge value="pendente">Ajustado</Badge></span> : null}
                    </td>
                    <td className="text-slate-500">{dia.dia}</td>
                    <td className={cn("tabular-nums", dia.situacao ? "font-semibold text-amber-700" : "")}>{dia.situacao || dia.entrada1 || "—"}</td>
                    <td className="tabular-nums">{dia.saida1 || (dia.incompleta && dia.entrada1 ? <span className="font-semibold text-amber-700">Sem saída</span> : "—")}</td>
                    <td className="tabular-nums">{dia.entrada2 || "—"}</td>
                    <td className="tabular-nums">{dia.saida2 || (dia.incompleta && dia.entrada2 ? <span className="font-semibold text-amber-700">Sem saída</span> : "—")}</td>
                    <td className="font-semibold tabular-nums">{dia.total}</td>
                    <td className="tabular-nums text-slate-500">{dia.carga}</td>
                    <td className={cn("font-semibold tabular-nums", dia.saldoNegativo ? "text-rose-700" : dia.saldo !== "00:00:00" ? "text-emerald-700" : "text-slate-500")}>
                      {dia.saldoNegativo ? "-" : dia.saldo !== "00:00:00" ? "+" : ""}{dia.saldo}
                    </td>
                    {temBanco ? <td className={cn("tabular-nums", dia.bancoNegativo ? "text-rose-700" : "")}>{dia.banco || "—"}</td> : null}
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
type OpcaoCampo = { valor: string; rotulo: string };
/** Opções do select: fixas ou calculadas a partir dos outros campos (ex.: jornadas da modalidade escolhida). */
type CampoFormulario = [string, string, string, (OpcaoCampo[] | ((valores: Record<string, string>) => OpcaoCampo[]))?, ((valores: Record<string, string>) => boolean)?];

export function Formulario({ titulo, descricao, destino, voltar, campos, extra = {}, iniciais = {}, semSelecione = [], aoFechar, ajudas = {}, aviso }: {
  /** Texto curto embaixo do campo explicando para que ele serve. */
  ajudas?: Record<string, string>;
  /** Aviso no topo do formulário (ex.: falta cadastrar algo antes). */
  aviso?: ReactNode;
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
  const obrigatorio = (chave: string, tipo: string) => (tipo !== "time" && tipo !== "select" && !["email", "celular", "departamento", "salario", "cidade", "tolerancia"].includes(chave)) || chave === "modalidade" || chave === "jornada";
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
          {aviso}
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.filter(([, , , , mostrar]) => !mostrar || mostrar(valores)).map(([chave, rotulo, tipo, opcoes]) => (
              <Field key={chave} label={rotulo} className={chave === "jornada" ? "sm:col-span-2" : ""} dica={obrigatorio(chave, tipo) ? "obrigatório" : undefined} erro={camposErro[chave]}>
                {tipo === "select" ? (
                  <Select aria-label={rotulo} required={obrigatorio(chave, tipo)} value={valores[chave] ?? ""} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })}>
                    {semSelecione.includes(chave) ? null : <option value="">Selecione</option>}
                    {(typeof opcoes === "function" ? opcoes(valores) : opcoes ?? []).map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                  </Select>
                ) : (
                  <Input aria-label={rotulo} required={obrigatorio(chave, tipo)} type={tipo} autoComplete={tipo === "password" ? "new-password" : undefined} minLength={tipo === "password" ? 6 : undefined} value={valores[chave] ?? ""} onChange={(event) => { if (chave === "cpf") setReativar(false); setValores({ ...valores, [chave]: event.target.value }); }} />
                )}
                {ajudas[chave] ? <span className="text-xs text-slate-500">{ajudas[chave]}</span> : null}
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
