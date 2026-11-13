import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Check } from "lucide-react";

/** Junta classes ignorando vazios. */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const buttonBase = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const variants = {
  primary: "bg-violet-700 text-white shadow-[0_1px_2px_rgb(76_29_149/0.25)] hover:bg-violet-800",
  secondary: "bg-white text-ink ring-1 ring-slate-200 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={cn(buttonBase, variants[variant], className)} {...props} />;
}

/** Mesmo visual do Button, para links (react-router Link recebe className). */
export function botao(variant: keyof typeof variants = "primary", extra = "") {
  return cn(buttonBase, variants[variant], extra);
}

const campoBase = "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-600/15";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-10", campoBase, className)} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("h-10", campoBase, className)} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-24 py-2 leading-6", campoBase, className)} />;
}

export function Field({ label, dica, erro, className = "", children }: { label: string; dica?: string; erro?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid content-start gap-1.5", className)}>
      <span className="text-sm font-medium text-slate-700">{label}{dica ? <span className="ml-1.5 font-normal text-slate-400">{dica}</span> : null}</span>
      {children}
      {erro ? <span className="text-xs text-rose-600">{erro}</span> : null}
    </label>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(28_21_36/0.05)]", className)}>{children}</section>;
}

/** Cabeçalho das telas: título, uma frase do que a tela faz e as ações principais à direita. */
export function CabecalhoPagina({ titulo, descricao, acoes, children }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{titulo}</h1>
        {descricao ? <p className="max-w-2xl text-sm text-slate-500">{descricao}</p> : null}
        {children}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </header>
  );
}

/** Filtro em chips: um selecionado por vez, com contagem opcional. */
export function FiltroChips<T extends string>({ opcoes, valor, onChange, rotulo }: {
  opcoes: Array<{ id: T; rotulo: string; contagem?: number }>;
  valor: T;
  onChange: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={rotulo}>
      {opcoes.map((opcao) => {
        const ativo = opcao.id === valor;
        return (
          <button
            key={opcao.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(opcao.id)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 transition",
              ativo ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {opcao.rotulo}
            {opcao.contagem != null ? <span className={cn("tabular-nums", ativo ? "text-violet-100" : "text-slate-400")}>{opcao.contagem}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Quantos resultados a lista mostra. */
export function Resumo({ total, singular, plural, carregando }: { total: number; singular: string; plural: string; carregando?: boolean }) {
  return (
    <p className="text-sm text-slate-500" aria-live="polite">
      {carregando ? "Carregando…" : <><span className="font-bold tabular-nums text-ink">{total.toLocaleString("pt-BR")}</span> {total === 1 ? singular : plural}</>}
    </p>
  );
}

/** Mensagem de erro ou aviso, no mesmo formato em todas as telas. */
export function Alerta({ children, tom = "erro" }: { children: ReactNode; tom?: "erro" | "aviso" | "info" | "ok" }) {
  const estilo = tom === "erro" ? "bg-rose-50 text-rose-700" : tom === "aviso" ? "bg-amber-50 text-amber-800" : tom === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-violet-50 text-violet-800";
  return <p role={tom === "erro" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2 text-sm", estilo)}>{children}</p>;
}

const badgeStyles: Record<string, string> = {
  aberta: "bg-emerald-50 text-emerald-800",
  ativo: "bg-emerald-50 text-emerald-800",
  paga: "bg-emerald-50 text-emerald-800",
  pausada: "bg-amber-50 text-amber-800",
  pendente: "bg-amber-50 text-amber-800",
  contratada: "bg-sky-50 text-sky-800",
  fechada: "bg-slate-100 text-slate-600",
  encerrado: "bg-slate-100 text-slate-600",
  inativo: "bg-slate-100 text-slate-600",
  vencida: "bg-rose-50 text-rose-700",
  estagio: "bg-violet-50 text-violet-800",
  clt: "bg-sky-50 text-sky-800",
};

/** Selo de situação ou modalidade. A cor sai do texto normalizado (Aberta, Estágio, CLT…). */
export function Badge({ value, children }: { value?: string | null; children: ReactNode }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", badgeStyles[chave(value)] ?? "bg-slate-100 text-slate-700")}>{children}</span>;
}

export function chave(valor?: string | null) {
  const texto = (valor ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (texto.startsWith("estagi")) return "estagio";
  if (texto.includes("clt") || texto.includes("efetiv")) return "clt";
  return texto;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-200/70", className)} />;
}

export function Empty({ titulo, texto, acao }: { titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-ink">{titulo}</h3>
      <p className="max-w-md text-sm text-slate-500">{texto}</p>
      {acao ? <div className="mt-3">{acao}</div> : null}
    </div>
  );
}

/** Bloco numerado de formulário, como nos cadastros do interno. */
export function Bloco({ numero, titulo, texto, feito = false, children }: { numero: number; titulo: string; texto: string; feito?: boolean; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(28_21_36/0.05)] md:p-5">
      <header className="flex items-start gap-3">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold", feito ? "bg-emerald-50 text-emerald-800" : "bg-violet-700 text-white")}>
          {feito ? <Check size={14} /> : numero}
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">{titulo}</h2>
          <p className="text-sm text-slate-500">{texto}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
