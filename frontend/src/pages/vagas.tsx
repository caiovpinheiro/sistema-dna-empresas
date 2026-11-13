import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Check, ChevronRight, GraduationCap, MapPin, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { dataBr, dinheiro, haQuantoTempo } from "../lib/formato";
import { Alerta, Badge, Bloco, Button, CabecalhoPagina, Card, Empty, Field, FiltroChips, Input, Skeleton, Textarea, botao, chave, cn } from "../components/ui";
import { CampoBusca, type VagaLinha } from "./consultas";

type Situacao = "aberta" | "pausada" | "contratada" | "fechada" | "todas";
export type TipoVaga = "1" | "2";

const TIPOS: Record<TipoVaga, { nome: string; texto: string; icone: typeof Briefcase; salario: string; carga: string }> = {
  "1": { nome: "Estágio", texto: "Para estudantes. Bolsa-auxílio e contrato com a instituição de ensino.", icone: GraduationCap, salario: "Bolsa-auxílio", carga: "Ex.: 30 horas semanais" },
  "2": { nome: "CLT", texto: "Carteira assinada, com os direitos da CLT.", icone: Briefcase, salario: "Salário", carga: "Ex.: 44 horas semanais" },
};

/** Primeira opção de abrir vaga liberada para o usuário, ou null. */
export function linkAbrirVaga(tipos: TipoVaga[]) {
  return tipos.length ? `/vagas/nova?tipo=${tipos.includes("1") ? "1" : tipos[0]}` : null;
}

export function VagasPage({ tipos }: { tipos: TipoVaga[] }) {
  const [texto, setTexto] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("aberta");
  const lista = useQuery({ queryKey: ["/api/v1/empresa/vagas", ""], queryFn: () => api<VagaLinha[]>("/api/v1/empresa/vagas?q=") });
  const todas = lista.data?.data ?? [];
  const contagem = (id: Situacao) => (id === "todas" ? todas.length : todas.filter((vaga) => chave(vaga.situacao) === id).length);
  const termo = texto.trim().toLowerCase();
  const linhas = todas.filter((vaga) => (situacao === "todas" || chave(vaga.situacao) === situacao)
    && (!termo || [vaga.cargo, vaga.cidade, vaga.codigo, vaga.contrato].some((campo) => (campo ?? "").toLowerCase().includes(termo))));
  const abrir = linkAbrirVaga(tipos);
  const opcoes = (["aberta", "pausada", "contratada", "fechada", "todas"] as Situacao[])
    .map((id) => ({ id, rotulo: { aberta: "Em aberto", pausada: "Pausadas", contratada: "Contratadas", fechada: "Encerradas", todas: "Todas" }[id], contagem: lista.isLoading ? undefined : contagem(id) }))
    .filter((opcao) => opcao.id === "aberta" || opcao.id === "todas" || (opcao.contagem ?? 0) > 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <CabecalhoPagina
        titulo="Vagas"
        descricao="Acompanhe as vagas da empresa com a DNA Work. Clique no cargo para ver todos os detalhes."
        acoes={abrir ? <Link to={abrir} className={botao("primary", "botao")}><Plus size={16} /> Abrir vaga</Link> : null}
      />
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[16rem] flex-1"><CampoBusca valor={texto} onChange={setTexto} placeholder="Buscar por cargo, cidade ou código" /></div>
        <FiltroChips rotulo="Situação da vaga" valor={situacao} onChange={setSituacao} opcoes={opcoes} />
      </Card>
      {lista.isError ? <Alerta>{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar as vagas."}</Alerta> : null}
      {lista.isLoading ? <Skeleton className="h-64" /> : null}
      {!lista.isLoading && !lista.isError && linhas.length === 0 ? (
        termo ? <Empty titulo="Nenhuma vaga encontrada" texto="Confira a grafia ou limpe a busca." />
          : situacao === "aberta" ? <Empty titulo="Nenhuma vaga em aberto" texto="Quando precisar contratar, abra uma vaga e a DNA Work começa a seleção." acao={abrir ? <Link to={abrir} className={botao("primary", "botao")}><Plus size={16} /> Abrir vaga</Link> : null} />
            : <Empty titulo="Nenhuma vaga nesta situação" texto="Troque a situação para ver as outras vagas." />
      ) : null}
      {linhas.length ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr><th>Cargo</th><th>Modalidade</th><th className="text-center">Posições</th><th className="text-right">Salário / bolsa</th><th>Cidade</th><th>Abertura</th><th>Situação</th><th><span className="sr-only">Abrir</span></th></tr>
              </thead>
              <tbody>
                {linhas.map((vaga) => (
                  <tr key={vaga.id}>
                    <td className="max-w-72">
                      <Link className="block truncate" to={`/vagas/${vaga.id}`}>{vaga.cargo || "Vaga"}</Link>
                      {codigoCurto(vaga.codigo) ? <p className="text-xs text-slate-500">Código {vaga.codigo}</p> : null}
                    </td>
                    <td>{vaga.contrato ? <Badge value={vaga.contrato}>{vaga.contrato}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="text-center tabular-nums">{vaga.vagas ?? "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{dinheiro(vaga.salario)}</td>
                    <td>{vaga.cidade || <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap">
                      <p className="tabular-nums">{dataBr(vaga.dataabertura)}</p>
                      {chave(vaga.situacao) === "aberta" && haQuantoTempo(vaga.dataabertura) ? <p className="text-xs text-slate-500">{haQuantoTempo(vaga.dataabertura)}</p> : null}
                    </td>
                    <td><Badge value={vaga.situacao}>{vaga.situacao}</Badge></td>
                    <td className="w-px whitespace-nowrap text-right"><Link to={`/vagas/${vaga.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 lg:hidden">
            {linhas.map((vaga) => (
              <li key={vaga.id}>
                <Link to={`/vagas/${vaga.id}`} className="grid gap-2 px-4 py-3.5 transition hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-violet-800">{vaga.cargo || "Vaga"}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} /> {vaga.cidade || "Cidade não informada"}</p>
                    </div>
                    <Badge value={vaga.situacao}>{vaga.situacao}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    {vaga.contrato ? <Badge value={vaga.contrato}>{vaga.contrato}</Badge> : null}
                    <span className="inline-flex items-center gap-1"><Users size={13} /> {vaga.vagas ?? "—"}</span>
                    <span className="tabular-nums">{dinheiro(vaga.salario)}</span>
                    <span className="text-xs text-slate-500">Aberta em {dataBr(vaga.dataabertura)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function codigoCurto(codigo: string | null) {
  return Boolean(codigo && codigo.length <= 12);
}

type Valores = { cargo: string; quantidade: string; cidade: string; salario: string; horario: string; cargaHoraria: string; atividades: string; requisitos: string; beneficios: string; observacao: string };
const VAZIO: Valores = { cargo: "", quantidade: "1", cidade: "", salario: "", horario: "", cargaHoraria: "", atividades: "", requisitos: "", beneficios: "", observacao: "" };

export function VagaNova({ tipo: tipoInicial, tipos }: { tipo: string; tipos: TipoVaga[] }) {
  const liberados: TipoVaga[] = tipos.length ? tipos : [tipoInicial === "1" ? "1" : "2"];
  const [tipo, setTipo] = useState<TipoVaga>(liberados.includes(tipoInicial as TipoVaga) ? tipoInicial as TipoVaga : liberados[0]);
  const [valores, setValores] = useState<Valores>(VAZIO);
  const [erro, setErro] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [criada, setCriada] = useState<{ id: string; cargo: string } | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const info = TIPOS[tipo];
  const mudar = (campo: keyof Valores) => (event: { target: { value: string } }) => {
    setValores((atual) => ({ ...atual, [campo]: event.target.value }));
    if (campos[campo]) setCampos((atual) => ({ ...atual, [campo]: "" }));
  };
  const salvar = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/empresa/vagas", { method: "POST", body: JSON.stringify({ tipo, ...valores }) }),
    onSuccess: async (resposta) => {
      await client.invalidateQueries();
      setCriada({ id: resposta.data.id, cargo: valores.cargo.trim() });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.message : "Não foi possível abrir a vaga. Tente de novo em instantes.");
      if (error instanceof ApiError && error.campos) setCampos(error.campos);
    },
  });
  const quantidade = Number(valores.quantidade);
  const quantidadeOk = Number.isInteger(quantidade) && quantidade >= 1 && quantidade <= 999;
  const podeSalvar = Boolean(valores.cargo.trim()) && quantidadeOk;
  const resumo = useMemo(() => [
    ["Modalidade", info.nome],
    ["Cargo", valores.cargo.trim()],
    ["Posições", quantidadeOk ? String(quantidade) : ""],
    ["Cidade", valores.cidade.trim()],
    [info.salario, valores.salario.trim() ? dinheiro(valores.salario) : "A combinar"],
    ["Horário", valores.horario.trim()],
  ] as Array<[string, string]>, [info, valores, quantidade, quantidadeOk]);

  if (criada) {
    return (
      <Card className="mx-auto grid w-full max-w-xl justify-items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check size={28} /></span>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Vaga aberta</h1>
        <p className="max-w-sm text-sm text-slate-500"><strong className="text-ink">{criada.cargo}</strong> já aparece em Vagas, na situação Em aberto. A equipe da DNA Work recebe a vaga para começar a seleção.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link to={`/vagas/${criada.id}`} className={botao("primary", "botao")}>Ver a vaga</Link>
          <Link to="/vagas" className={botao("secondary", "botao")}>Vagas em aberto</Link>
          <Button variant="ghost" onClick={() => { setCriada(null); setValores(VAZIO); setErro(""); }}><Plus size={16} /> Abrir outra</Button>
        </div>
      </Card>
    );
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={(event) => {
      event.preventDefault();
      setErro("");
      if (!valores.cargo.trim()) { setCampos({ cargo: "Informe o cargo da vaga." }); setErro("Informe o cargo da vaga."); return; }
      if (!quantidadeOk) { setCampos({ quantidade: "Use um número de 1 a 999." }); setErro("A quantidade de posições precisa ser de 1 a 999."); return; }
      salvar.mutate();
    }}>
      <Link to="/vagas" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink"><ArrowLeft size={16} /> Vagas</Link>
      <CabecalhoPagina titulo="Abrir vaga" descricao="Conte o que a vaga precisa. Só o cargo é obrigatório; quanto mais detalhes, mais rápido a DNA Work encontra a pessoa certa." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Bloco numero={1} titulo="Modalidade" texto="Escolha o tipo de contratação." feito>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Modalidade">
              {liberados.map((id) => {
                const opcao = TIPOS[id];
                const ativo = id === tipo;
                return (
                  <button key={id} type="button" role="radio" aria-checked={ativo} onClick={() => setTipo(id)}
                    className={cn("flex items-start gap-3 rounded-xl border p-3.5 text-left transition", ativo ? "border-violet-600 bg-violet-50 ring-2 ring-violet-600/20" : "border-slate-200 bg-white hover:border-violet-300")}>
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", ativo ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-600")}><opcao.icone size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-ink">{opcao.nome}</span>
                      <span className="block text-xs text-slate-500">{opcao.texto}</span>
                    </span>
                    {ativo ? <Check size={18} className="shrink-0 text-violet-700" /> : null}
                  </button>
                );
              })}
            </div>
          </Bloco>

          <Bloco numero={2} titulo="Sobre a vaga" texto="Cargo, quantas pessoas e onde vão trabalhar." feito={Boolean(valores.cargo.trim()) && quantidadeOk}>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field className="sm:col-span-4" label="Cargo" dica="obrigatório" erro={campos.cargo}>
                <Input autoFocus required maxLength={200} placeholder={tipo === "1" ? "Ex.: Estagiário administrativo" : "Ex.: Auxiliar administrativo"} value={valores.cargo} onChange={mudar("cargo")} aria-invalid={Boolean(campos.cargo)} />
              </Field>
              <Field className="sm:col-span-2" label="Posições" erro={campos.quantidade}>
                <Input type="number" inputMode="numeric" min={1} max={999} value={valores.quantidade} onChange={mudar("quantidade")} aria-invalid={Boolean(campos.quantidade)} />
              </Field>
              <Field className="sm:col-span-3" label="Cidade">
                <Input maxLength={120} placeholder="Ex.: São Paulo" value={valores.cidade} onChange={mudar("cidade")} />
              </Field>
              <Field className="sm:col-span-3" label={`${info.salario} (R$)`} erro={campos.salario}>
                <Input inputMode="decimal" maxLength={40} placeholder="Ex.: 1.500,00 (vazio = a combinar)" value={valores.salario} onChange={mudar("salario")} aria-invalid={Boolean(campos.salario)} />
              </Field>
            </div>
          </Bloco>

          <Bloco numero={3} titulo="Jornada" texto="Dias e horário de trabalho." feito={Boolean(valores.horario.trim() || valores.cargaHoraria.trim())}>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field className="sm:col-span-4" label="Horário">
                <Input maxLength={300} placeholder="Ex.: Segunda a sexta, das 9h às 15h" value={valores.horario} onChange={mudar("horario")} />
              </Field>
              <Field className="sm:col-span-2" label="Carga horária">
                <Input maxLength={120} placeholder={info.carga} value={valores.cargaHoraria} onChange={mudar("cargaHoraria")} />
              </Field>
            </div>
          </Bloco>

          <Bloco numero={4} titulo="Detalhes" texto="O que a pessoa vai fazer e o que a vaga oferece. Tudo opcional." feito={Boolean(valores.atividades.trim() || valores.requisitos.trim() || valores.beneficios.trim())}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Atividades">
                <Textarea maxLength={4000} placeholder="Ex.: Atendimento ao cliente, organização de documentos…" value={valores.atividades} onChange={mudar("atividades")} />
              </Field>
              <Field label="Requisitos">
                <Textarea maxLength={4000} placeholder={tipo === "1" ? "Ex.: Cursando Administração a partir do 2º semestre" : "Ex.: Ensino médio completo, experiência com Excel"} value={valores.requisitos} onChange={mudar("requisitos")} />
              </Field>
              <Field label="Benefícios">
                <Textarea maxLength={4000} placeholder="Ex.: Vale-transporte, vale-refeição" value={valores.beneficios} onChange={mudar("beneficios")} />
              </Field>
              <Field label="Observação para a DNA Work">
                <Textarea maxLength={4000} placeholder="Algo mais que devemos saber?" value={valores.observacao} onChange={mudar("observacao")} />
              </Field>
            </div>
          </Bloco>
        </div>

        <aside className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(28_21_36/0.05)] xl:sticky xl:top-20">
          <div>
            <p className="text-[15px] font-bold text-ink">Resumo da vaga</p>
            <p className="text-sm text-slate-500">Confira antes de abrir.</p>
          </div>
          <dl className="grid gap-2 text-sm">
            {resumo.map(([rotulo, valor]) => (
              <div key={rotulo} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0">
                <dt className="text-slate-500">{rotulo}</dt>
                <dd className={cn("truncate text-right font-semibold", valor ? "text-ink" : "text-slate-300")}>{valor || "—"}</dd>
              </div>
            ))}
          </dl>
          {erro ? <Alerta>{erro}</Alerta> : null}
          <Button type="submit" className="h-11 w-full" disabled={!podeSalvar || salvar.isPending}>
            <Briefcase size={16} /> {salvar.isPending ? "Abrindo vaga…" : "Abrir vaga"}
          </Button>
          {!podeSalvar ? <p className="text-xs text-slate-500">Preencha o cargo para abrir a vaga.</p> : null}
          <button type="button" className="text-sm font-semibold text-slate-500 hover:text-ink" onClick={() => navigate("/vagas")}>Cancelar</button>
        </aside>
      </div>
    </form>
  );
}
