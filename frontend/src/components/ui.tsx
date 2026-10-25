import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const buttonBase = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const variants = {
  primary: "bg-[#6a4b84] text-white hover:bg-[#593d70]",
  secondary: "bg-white text-[#24182d] ring-1 ring-[#eadff0] hover:bg-[#fbf8fc]",
  ghost: "text-[#6a4b84] hover:bg-[#f3e8f5]",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-10 w-full rounded-lg border border-[#eadff0] bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-[#6a4b84] focus:ring-4 focus:ring-[#6a4b84]/15 ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-10 w-full rounded-lg border border-[#eadff0] bg-white px-3 text-sm text-[#24182d] outline-none focus:border-[#6a4b84] focus:ring-4 focus:ring-[#6a4b84]/15 ${className}`} />;
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
  return <section className={`rounded-xl border border-[#eadff0] bg-white p-4 ${className}`}>{children}</section>;
}
