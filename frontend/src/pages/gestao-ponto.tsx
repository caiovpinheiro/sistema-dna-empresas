import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { NavLink, Navigate, useLocation } from "react-router-dom";
import { Alerta, Empty, Skeleton, cn } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { ColaboradoresPonto, RelatorioPonto, RelatorioPontoColaborador } from "./ponto";
import { SolicitacoesPonto } from "./solicitacoes-ponto";
import { JornadasPage } from "./jornadas";
import { FeriadosPage } from "./feriados";

type Aba = { id: string; label: string; link: string };

/**
 * Gestão do ponto pelo app do colaborador (/ponto/gestao/...). São as telas do ponto do portal da empresa, mas o
 * servidor só mostra o que a empresa liberou para este colaborador e só dos colaboradores escolhidos para ele.
 */
export function GestaoPonto() {
  const sessao = useQuery({ queryKey: ["gestao-ponto-sessao"], queryFn: () => api<{ abas: Aba[] }>("/api/v1/ponto/gestao/sessao"), retry: false });
  const { pathname } = useLocation();
  const naoLogado = sessao.error instanceof ApiError && sessao.error.status === 401;
  useEffect(() => {
    if (naoLogado) window.location.assign("/ponto/login");
  }, [naoLogado]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const abas = sessao.data?.data.abas ?? [];
  const liberada = (link: string) => abas.some((aba) => aba.link === link);
  const primeira = abas[0]?.link;

  let conteudo = null;
  if (pathname === "/ponto/colaboradores" && liberada("/ponto/colaboradores")) conteudo = <ColaboradoresPonto />;
  else if (pathname.startsWith("/ponto/colaborador/") && liberada("/ponto/colaboradores")) conteudo = <RelatorioPontoColaborador id={decodeURIComponent(pathname.slice("/ponto/colaborador/".length))} />;
  else if (pathname === "/ponto/solicitacoes" && liberada("/ponto/solicitacoes")) conteudo = <SolicitacoesPonto />;
  else if (pathname === "/ponto/relatorio" && liberada("/ponto/relatorio")) conteudo = <RelatorioPonto />;
  else if (pathname === "/jornadas" && liberada("/jornadas")) conteudo = <JornadasPage />;
  else if (pathname === "/feriados" && liberada("/feriados")) conteudo = <FeriadosPage />;

  return (
    <div className="app-canvas min-h-dvh bg-[#f3f1f7]">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
          <a href="/ponto" className="inline-flex items-center gap-1 text-sm font-semibold text-[#5b21b6] hover:underline"><ArrowLeft size={16} /> Meu ponto</a>
          <p className="text-sm font-extrabold text-ink">Gestão do ponto da equipe</p>
        </div>
        {abas.length ? (
          <nav className="menu-sem-barra mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 pb-2 md:px-6" aria-label="Gestão do ponto">
            {abas.map((aba) => (
              <NavLink key={aba.id} to={aba.link}
                className={({ isActive }) => cn("shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition", isActive || (aba.id === "colaboradores" && pathname.startsWith("/ponto/colaborador/")) ? "bg-violet-100 text-violet-800" : "text-slate-600 hover:bg-slate-100")}>
                {aba.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-5 md:px-6 md:pt-6">
        {sessao.isLoading || naoLogado ? <Skeleton className="h-60" /> : null}
        {sessao.isError && !naoLogado ? <Alerta>{sessao.error instanceof ApiError ? sessao.error.message : "Não foi possível abrir a gestão do ponto."}</Alerta> : null}
        {sessao.data && !abas.length ? <Empty titulo="Sem permissões" texto="A empresa ainda não liberou a gestão do ponto para você." /> : null}
        {sessao.data && abas.length && !conteudo && primeira ? <Navigate to={primeira} replace /> : null}
        {conteudo ? <div key={pathname} className="motion-pop min-w-0">{conteudo}</div> : null}
      </main>
    </div>
  );
}
