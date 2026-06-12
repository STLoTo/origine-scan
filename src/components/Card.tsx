import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = "" }: Props) {
  return (
    <section
      className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg ${className}`}
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}
