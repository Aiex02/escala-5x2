import { useRef, type KeyboardEvent } from "react";
import { CalendarDays, Clock, Minus, Plus } from "lucide-react";
import { formatarNumero, horaParaMinutos } from "../../util/formato";

/** "37,5" | "37.5" -> 37.5; vazio ou inválido -> NaN. */
export function lerNumero(texto: string): number {
  const t = texto.trim().replace(",", ".");
  return t === "" || !/^-?\d*\.?\d*$/.test(t) ? NaN : Number(t);
}

interface NumeroProps {
  id: string;
  valor: string;
  onMudar: (valor: string) => void;
  min?: number;
  max?: number;
  passo?: number;
  decimais?: boolean;
  sufixo?: string;
  invalido?: boolean;
  rotuloAria?: string;
}

/**
 * Número com botões − e + próprios (as setas nativas do `type="number"` mudam
 * entre sistemas). Aceita vírgula decimal; setas do teclado também ajustam.
 */
export function CampoNumero({ id, valor, onMudar, min = 0, max = Number.MAX_SAFE_INTEGER, passo = 1, decimais = false, sufixo, invalido, rotuloAria }: NumeroProps) {
  function ajustar(direcao: 1 | -1) {
    const atual = lerNumero(valor);
    const base = Number.isNaN(atual) ? min : atual;
    const proximo = Math.min(max, Math.max(min, Math.round((base + direcao * passo) * 100) / 100));
    onMudar(decimais ? formatarNumero(proximo) : String(Math.round(proximo)));
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      ajustar(e.key === "ArrowUp" ? 1 : -1);
    }
  }

  const numero = lerNumero(valor);
  return (
    <div className={invalido ? "entrada campo-numero entrada-invalida" : "entrada campo-numero"}>
      <input
        id={id}
        type="text"
        inputMode={decimais ? "decimal" : "numeric"}
        spellCheck={false}
        autoComplete="off"
        value={valor}
        aria-label={rotuloAria}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? `${id}-erro` : undefined}
        onChange={(e) => {
          const filtrado = e.target.value.replace(decimais ? /[^\d.,]/g : /\D/g, "");
          onMudar(filtrado);
        }}
        onKeyDown={aoTeclar}
      />
      {sufixo && <span className="entrada-sufixo">{sufixo}</span>}
      <span className="passos">
        <button type="button" tabIndex={-1} aria-label="Diminuir" disabled={!Number.isNaN(numero) && numero <= min} onClick={() => ajustar(-1)}>
          <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button type="button" tabIndex={-1} aria-label="Aumentar" disabled={!Number.isNaN(numero) && numero >= max} onClick={() => ajustar(1)}>
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

interface HoraProps {
  id: string;
  valor: string;
  onMudar: (valor: string) => void;
  invalido?: boolean;
  rotuloAria?: string;
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Completa entradas curtas: "7" -> "07:00", "730" -> "07:30", "0730" -> "07:30". */
export function normalizarHora(texto: string): string {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length === 0) return "";
  let h: number;
  let m: number;
  if (digitos.length <= 2) {
    h = Number(digitos);
    m = 0;
  } else if (digitos.length === 3) {
    h = Number(digitos.slice(0, 1));
    m = Number(digitos.slice(1));
  } else {
    h = Number(digitos.slice(0, 2));
    m = Number(digitos.slice(2, 4));
  }
  return h > 23 || m > 59 ? texto : `${doisDigitos(h)}:${doisDigitos(m)}`;
}

/**
 * Horário HH:MM em caixa de texto com máscara (o `type="time"` nativo tem
 * formatos e seletores diferentes em cada sistema). Setas: ±15 minutos.
 */
export function CampoHora({ id, valor, onMudar, invalido, rotuloAria }: HoraProps) {
  const ref = useRef<HTMLInputElement>(null);

  function deslocar(minutos: number) {
    const atual = horaParaMinutos(valor) ?? 0;
    const proximo = (((atual + minutos) % 1440) + 1440) % 1440;
    onMudar(`${doisDigitos(Math.floor(proximo / 60))}:${doisDigitos(proximo % 60)}`);
  }

  return (
    <div className={invalido ? "entrada campo-hora entrada-invalida" : "entrada campo-hora"}>
      <Clock className="entrada-icone" size={16} strokeWidth={1.9} aria-hidden="true" />
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        maxLength={5}
        spellCheck={false}
        autoComplete="off"
        value={valor}
        aria-label={rotuloAria}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? `${id}-erro` : undefined}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, "").slice(0, 4);
          onMudar(digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos);
        }}
        onBlur={() => onMudar(normalizarHora(valor))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            deslocar(e.key === "ArrowUp" ? 15 : -15);
          }
        }}
      />
    </div>
  );
}

/** "2026-10-16" -> "16/10/2026" */
export function isoParaBr(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}

/** "16/10/2026" -> "2026-10-16" (null se inválida). */
export function brParaIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const [, d, mes, a] = m;
  const data = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  const ok = data.getUTCFullYear() === Number(a) && data.getUTCMonth() === Number(mes) - 1 && data.getUTCDate() === Number(d);
  return ok ? `${a}-${mes}-${d}` : null;
}

interface DataProps {
  id: string;
  /** "dd/mm/aaaa" enquanto digita. */
  valor: string;
  onMudar: (valor: string) => void;
  invalido?: boolean;
}

/** Data dd/mm/aaaa com máscara (o `type="date"` nativo muda entre sistemas). */
export function CampoData({ id, valor, onMudar, invalido }: DataProps) {
  return (
    <div className={invalido ? "entrada campo-hora entrada-invalida" : "entrada campo-hora"}>
      <CalendarDays className="entrada-icone" size={16} strokeWidth={1.9} aria-hidden="true" />
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        spellCheck={false}
        autoComplete="off"
        value={valor}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? `${id}-erro` : undefined}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "").slice(0, 8);
          onMudar(d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
        }}
      />
    </div>
  );
}
