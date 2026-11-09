"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { salvarHoraExtraAcao } from "@/acoes/configuracao";
import { Button } from "@/componentes/ui/button";
import { Label } from "@/componentes/ui/label";
import { Switch } from "@/componentes/ui/switch";
import type { ConfiguracaoDto } from "@/servicos/dto";
import { CampoNumerico } from "./CampoNumerico";

export function SecaoHoraExtra({ config }: { config: ConfiguracaoDto }) {
  const [permitir, setPermitir] = useState(config.permitirHoraExtra);
  const [maxMin, setMaxMin] = useState(config.horaExtraDiariaMaxMin);
  const [pendente, iniciar] = useTransition();
  const valido = Number.isInteger(maxMin) && maxMin >= 0 && maxMin <= 240 && maxMin % 15 === 0;
  const alterado = permitir !== config.permitirHoraExtra || maxMin !== config.horaExtraDiariaMaxMin;

  function salvar() {
    iniciar(async () => {
      const r = await salvarHoraExtraAcao({ clienteId: config.clienteId, permitirHoraExtra: permitir, horaExtraDiariaMaxMin: maxMin });
      if (r.ok) toast.success("Salvo. Gere o mês de novo para aplicar.");
      else toast.error(r.erro);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-borda bg-superficie p-4">
        <Switch id="hora-extra" checked={permitir} onCheckedChange={setPermitir} className="mt-0.5" />
        <div className="space-y-1">
          <Label htmlFor="hora-extra" className="text-base font-medium">
            Permitir hora extra para cobrir o mínimo
          </Label>
          <p className="text-sm text-texto-suave">
            Quando ninguém cabe dentro das regras, o sistema estende a jornada de quem já está trabalhando (até o limite abaixo) para
            cobrir efetivo mínimo e funções. As horas a mais viram saldo positivo e são compensadas nos meses seguintes (banco de
            horas). Folgas e descanso de 11h nunca são quebrados: a EC 141 diz que hora extra não substitui o repouso.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <CampoNumerico
          id="hora-extra-max"
          rotulo="Hora extra máxima por dia"
          valor={maxMin}
          aoMudar={setMaxMin}
          min={0}
          max={240}
          step={15}
          sufixo="minutos"
          desabilitado={!permitir}
          dica="CLT art. 59: até 2h por dia, com jornada total de até 10h; compensação em até 6 meses por acordo individual."
        />
        {!valido && <p className="text-sm text-critico">Use um valor entre 0 e 240, em múltiplos de 15 minutos.</p>}
      </div>

      <p className="rounded-lg border border-borda bg-superficie p-4 text-sm text-texto-suave">
        Preferência de turno é só preferência: a cobertura do estabelecimento vem primeiro.
      </p>

      <Button onClick={salvar} disabled={!alterado || !valido || pendente}>
        {pendente && <Loader2 className="animate-spin" aria-hidden />}
        Salvar
      </Button>
    </div>
  );
}
