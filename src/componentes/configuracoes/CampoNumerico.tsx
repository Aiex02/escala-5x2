"use client";

import { useState } from "react";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";

type Props = {
  id: string;
  rotulo: string;
  /** Valor na unidade interna (ex.: minutos). */
  valor: number;
  aoMudar: (valor: number) => void;
  /** Quantas unidades internas valem 1 unidade exibida (ex.: 60 para mostrar minutos em horas). */
  escala?: number;
  min?: number;
  max?: number;
  step?: number;
  sufixo?: string;
  dica?: string;
  desabilitado?: boolean;
};

function ler(texto: string, escala: number): number | null {
  const n = Number(texto.replace(",", "."));
  if (texto.trim() === "" || !Number.isFinite(n)) return null;
  return Math.round(n * escala);
}

/** Campo numérico que aceita decimais com vírgula e converte para a unidade interna. */
export function CampoNumerico({
  id,
  rotulo,
  valor,
  aoMudar,
  escala = 1,
  min,
  max,
  step,
  sufixo,
  dica,
  desabilitado,
}: Props) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const texto = rascunho !== null && ler(rascunho, escala) === valor ? rascunho : String(valor / escala).replace(".", ",");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="numero w-24 font-mono"
          value={texto}
          disabled={desabilitado}
          min={min}
          max={max}
          step={step}
          aria-describedby={dica ? `${id}-dica` : undefined}
          onChange={(e) => {
            setRascunho(e.target.value);
            const n = ler(e.target.value, escala);
            if (n !== null) aoMudar(n);
          }}
          onBlur={() => setRascunho(null)}
        />
        {sufixo && <span className="text-sm text-texto-suave">{sufixo}</span>}
      </div>
      {dica && (
        <p id={`${id}-dica`} className="text-xs text-texto-suave">
          {dica}
        </p>
      )}
    </div>
  );
}
