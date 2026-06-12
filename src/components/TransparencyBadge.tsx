const LEVEL_STYLE = {
  high: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  low: "bg-rose-500/20 text-rose-300 border-rose-500/40",
} as const;

const LEVEL_LABEL = {
  high: "Alta",
  medium: "Media",
  low: "Bassa",
} as const;

interface Props {
  level: keyof typeof LEVEL_STYLE;
}

export function TransparencyBadge({ level }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}
    >
      Trasparenza {LEVEL_LABEL[level]}
    </span>
  );
}
