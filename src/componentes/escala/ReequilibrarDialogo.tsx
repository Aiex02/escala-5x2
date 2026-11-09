"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reequilibrarAcao } from "@/acoes/agenda";
import { Button } from "@/componentes/ui/button";
import { Checkbox } from "@/componentes/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/componentes/ui/dialog";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";

type Props = {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  clienteId: string;
  ano: number;
  mes: number;
  hoje: string;
  /** Existe algum mês gerado depois deste. */
  temMesesSeguintes: boolean;
};

export function ReequilibrarDialogo({ aberto, aoMudar, clienteId, ano, mes, hoje, temMesesSeguintes }: Props) {
  const primeiro = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimo = `${ano}-${String(mes).padStart(2, "0")}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
  const padrao = hoje >= primeiro && hoje <= ultimo ? hoje : primeiro;
  const [data, setData] = useState(padrao);
  const [seguintes, setSeguintes] = useState(false);
  const [pendente, iniciar] = useTransition();

  const confirmar = () => {
    iniciar(async () => {
      const r = await reequilibrarAcao(clienteId, ano, mes, data, seguintes);
      if (r.ok) {
        toast.success(r.dados.meses > 1 ? `Reequilíbrio feito em ${r.dados.meses} meses.` : "Mês reequilibrado.", {
          description: r.dados.avisos > 0 ? `${r.dados.avisos} aviso(s) neste mês.` : "Sem avisos.",
        });
        aoMudar(false);
      } else {
        toast.error(r.erro);
      }
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !pendente && aoMudar(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reequilibrar o mês</DialogTitle>
          <DialogDescription>
            Redistribui as jornadas a partir da data escolhida, compensando o saldo de horas das semanas anteriores dentro das regras.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reeq-data">A partir de</Label>
            <Input id="reeq-data" type="date" min={primeiro} max={ultimo} value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
          </div>
          <p className="rounded-md border border-borda bg-superficie p-3 text-sm text-texto-suave">
            Ficam como estão: os dias antes da data escolhida e os dias que você ajustou à mão no quadro (marcados no canto da célula). Faltas e ausências
            registradas continuam valendo.
          </p>
          <div className="flex items-start gap-2">
            <Checkbox id="reeq-seguintes" checked={seguintes} onCheckedChange={(v) => setSeguintes(v === true)} disabled={!temMesesSeguintes} className="mt-0.5" />
            <Label htmlFor="reeq-seguintes" className="flex flex-col items-start gap-0.5 font-normal">
              Refazer também os meses seguintes já gerados
              <span className="text-xs text-texto-suave">
                {temMesesSeguintes ? "Cada mês é refeito do dia 1, mantendo os ajustes manuais dele, para levar o saldo adiante." : "Não há meses seguintes gerados."}
              </span>
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => aoMudar(false)} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pendente || data < primeiro || data > ultimo}>
            {pendente ? "Reequilibrando…" : "Reequilibrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
