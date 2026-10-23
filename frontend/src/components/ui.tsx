import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const buttonBase = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm";

const variants = {
  primary: "bg-purple-brand text-white hover:bg-[#5a3f70]",
  secondary: "bg-white text-[#24182d] ring-1 ring-slate-200 hover:bg-slate-50",
  ghost: "text-slate-600 shadow-none hover:bg-white/80 hover:shadow-none",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition duration-200 placeholder:text-slate-400 focus:border-purple-brand focus:ring-4 focus:ring-[#6a4b84]/20 ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-11 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-white transition duration-200 hover:bg-white/20 focus:ring-4 focus:ring-white/30 ${className}`} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`motion-pop rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${className}`}>{children}</section>;
}
