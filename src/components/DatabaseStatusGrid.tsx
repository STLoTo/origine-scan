import {
  DATABASE_CATALOG,
  LAMP_STYLE,
  type DatabaseLamp,
  type DatabaseLampStatus,
} from "../lib/databaseCatalog";

interface Props {
  lamps: DatabaseLamp[];
  compact?: boolean;
}

export function DatabaseStatusGrid({ lamps, compact }: Props) {
  return (
    <div
      className={`grid gap-2 ${compact ? "grid-cols-4 sm:grid-cols-7" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"}`}
    >
      {DATABASE_CATALOG.map((meta) => {
        const lamp = lamps.find((l) => l.id === meta.id) ?? {
          id: meta.id,
          status: "idle" as DatabaseLampStatus,
        };
        const style = LAMP_STYLE[lamp.status];

        return (
          <div
            key={meta.id}
            title={[meta.label, style.label, lamp.detail, lamp.ms != null ? `${lamp.ms}ms` : ""]
              .filter(Boolean)
              .join(" · ")}
            className={`flex flex-col items-center rounded-xl border bg-slate-900/80 p-2 ${style.ring}`}
          >
            <DatabaseLogo short={meta.short} color={meta.color} status={lamp.status} />
            <span className="mt-1 text-[10px] font-semibold tracking-wide text-slate-300">
              {meta.short}
            </span>
            <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {!compact && (
              <span className="mt-1 text-center text-[9px] leading-tight text-slate-500">
                {meta.searchBy.includes("barcode") && meta.searchBy.includes("name")
                  ? "EAN · nome"
                  : meta.searchBy.includes("barcode")
                    ? "solo EAN"
                    : "solo nome"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DatabaseLogo({
  short,
  color,
  status,
}: {
  short: string;
  color: string;
  status: DatabaseLampStatus;
}) {
  const dim = status === "skipped" || status === "not_configured" ? 0.45 : 1;

  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      aria-hidden
      style={{ opacity: dim }}
    >
      <circle cx="18" cy="18" r="16" fill={`${color}22`} stroke={color} strokeWidth="1.5" />
      <text
        x="18"
        y="21"
        textAnchor="middle"
        fill={color}
        fontSize="9"
        fontWeight="700"
        fontFamily="system-ui,sans-serif"
      >
        {short}
      </text>
    </svg>
  );
}
