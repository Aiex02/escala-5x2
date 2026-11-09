"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { salvarTurnoAcao } from "@/acoes/configuracao";
import { Button } from "@/componentes/ui/button";
import { EstadoVazio } from "@/componentes/shell/EstadoVazio";
import { CalendarClock } from "lucide-react";
import { CORES_TURNO } from "@/lib/coresTurno";
import { cn } from "@/lib/utils";
import { formatarHora } from "@/motor";
import type { TurnoDto } from "@/servicos/dto";
import { CampoNumerico } from "./CampoNumerico";
import { descreverMascaraDias } from "./utilFuncionamento";

function LinhaTurno({ clienteId, turno }: { clienteId: string; turno: TurnoDto }) {
  const [cor, setCor] = useState(turno.cor.toUpperCase());
  const [efetivo, setEfetivo] = useState(turno.efetivoMinimo);
  const [pendente, iniciar] = useTransition();
  const alterado = cor !== turno.cor.toUpperCase() || efetivo !== turno.efetivoMinimo;

  function salvar() {
    iniciar(async () => {
      const r = await salvarTurnoAcao({ clienteId, turnoId: turno.id, cor, efetivoMinimo: efetivo });
      if (r.ok) toast.success(`Turno ${turno.nome} salvo.`);
      else toast.error(r.erro);
    });
  }

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-borda bg-superficie p-4 lg:flex-row lg:items-end">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-display font-semibold">
          <span className="size-3 rounded-full" style={{ backgroundColor: cor }} aria-hidden />
          {turno.nome}
        </p>
        <p className="numero font-mono text-xs text-texto-suave">
          {formatarHora(turno.inicioMin)}–{formatarHora(turno.fimMin)}
          {turno.intervaloMin > 0 && ` · intervalo ${turno.intervaloMin} min`}
        </p>
        <p className="text-sm text-texto-suave">{descreverMascaraDias(turno.diasSemana)}</p>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Cor</legend>
        <div role="radiogroup" aria-label={`Cor do turno ${turno.nome}`} className="flex gap-1.5">
          {CORES_TURNO.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cor === c}
              aria-label={c}
              onClick={() => setCor(c)}
              className={cn(
                "grid size-7 place-items-center rounded-full border-2 outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50",
                cor === c ? "scale-110 border-texto" : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: c }}
            >
              {cor === c && <Check className="size-3.5 text-black/70" aria-hidden />}
            </button>
          ))}
        </div>
      </fieldset>

      <CampoNumerico
        id={`efetivo-${turno.id}`}
        rotulo="Efetivo mínimo"
        valor={efetivo}
        aoMudar={setEfetivo}
        sufixo="pessoas"
        dica="0 = sem mínimo"
      />

      <Button onClick={salvar} disabled={!alterado || pendente} variant={alterado ? "default" : "outline"}>
        {pendente && <Loader2 className="animate-spin" aria-hidden />}
        Salvar
      </Button>
    </li>
  );
}

export function SecaoTurnos({ clienteId, turnos }: { clienteId: string; turnos: TurnoDto[] }) {
  if (turnos.length === 0) {
    return (
      <EstadoVazio
        icone={CalendarClock}
        titulo="Nenhum turno ativo"
        descricao="Salve o funcionamento do cliente para gerar os turnos."
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-suave">
        Os horários vêm do funcionamento. Aqui você ajusta a cor e quantas pessoas, no mínimo, cada turno precisa ter.
      </p>
      <ul className="space-y-3">
        {turnos.map((t) => (
          <LinhaTurno key={`${t.id}-${t.cor}-${t.efetivoMinimo}`} clienteId={clienteId} turno={t} />
        ))}
      </ul>
    </div>
  );
}
