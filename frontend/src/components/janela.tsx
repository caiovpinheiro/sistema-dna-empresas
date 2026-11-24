import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";

/**
 * Janela (diálogo) por cima da página. Fecha no X, no Esc e clicando fora. No celular sobe de baixo e ocupa a largura.
 */
export function Janela({ titulo, descricao, aberta, onFechar, larga = false, children }: {
  titulo: string;
  descricao?: string;
  aberta: boolean;
  onFechar: () => void;
  /** Mais espaço no computador (ex.: a grade de dias da jornada). */
  larga?: boolean;
  children: ReactNode;
}) {
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Primeiro campo do formulário (ou o botão de fechar) recebe o foco.
    const primeiro = caixa.current?.querySelector<HTMLElement>("input, select, textarea") ?? caixa.current?.querySelector<HTMLElement>("button");
    primeiro?.focus();
    const tecla = (event: KeyboardEvent) => {
      if (event.key === "Escape") fechar.current();
    };
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("keydown", tecla);
      document.body.style.overflow = rolagem;
      anterior?.focus?.();
    };
  }, [aberta]);

  if (!aberta) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`grid max-h-[92vh] w-full gap-4 overflow-y-auto rounded-t-2xl bg-[#f6f4f8] p-4 shadow-2xl sm:rounded-2xl sm:p-5 ${larga ? "sm:max-w-5xl" : "sm:max-w-3xl"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id={idTitulo} className="text-lg font-extrabold tracking-tight text-ink">{titulo}</h2>
            {descricao ? <p className="text-sm text-slate-500">{descricao}</p> : null}
          </div>
          <button type="button" aria-label="Fechar" onClick={onFechar} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Janela de cadastro ligada ao endereço (?novo=1): o botão "voltar" do navegador fecha, e links antigos de cadastro
 * (ex.: /escalas/nova) abrem a lista já com a janela aberta.
 */
export function useCadastroNaUrl(): [boolean, () => void, () => void] {
  const [busca, setBusca] = useSearchParams();
  const aberta = busca.get("novo") === "1";
  const abrir = () => {
    const proxima = new URLSearchParams(busca);
    proxima.set("novo", "1");
    setBusca(proxima);
  };
  const fecharJanela = () => {
    const proxima = new URLSearchParams(busca);
    proxima.delete("novo");
    setBusca(proxima, { replace: true });
  };
  return [aberta, abrir, fecharJanela];
}
