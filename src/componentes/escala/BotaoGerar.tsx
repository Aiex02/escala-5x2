"use client";

import { useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { gerarMesAcao } from "@/acoes/agenda";
import { Button } from "@/componentes/ui/button";
import { nomeMes } from "@/lib/datas";

type Props = {
  clienteId: string;
  ano: number;
  mes: number;
  /** Motivo pelo qual não dá para gerar (botão desabilitado). */
  bloqueio?: string | null;
  variant?: "default" | "outline";
  rotulo?: string;
};

export function BotaoGerar({ clienteId, ano, mes, bloqueio, variant = "default", rotulo }: Props) {
  const [pendente, iniciar] = useTransition();
  const gerar = () =>
    iniciar(async () => {
      const r = await gerarMesAcao(clienteId, ano, mes);
      if (r.ok) {
        toast.success(`Escala de ${nomeMes(mes)} gerada.`, {
          description: r.dados.avisos > 0 ? `${r.dados.avisos} aviso(s) para revisar no painel.` : "Sem avisos.",
        });
      } else {
        toast.error(r.erro);
      }
    });
  return (
    <Button onClick={gerar} disabled={pendente || Boolean(bloqueio)} title={bloqueio ?? undefined} variant={variant}>
      <CalendarPlus aria-hidden />
      {pendente ? "Gerando…" : (rotulo ?? "Gerar escala")}
    </Button>
  );
}
