"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adicionarAusenciaAcao, removerAusenciaAcao } from "@/acoes/funcionarios";
import { Badge } from "@/componentes/ui/badge";
import { Button } from "@/componentes/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/componentes/ui/dialog";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Switch } from "@/componentes/ui/switch";
import { formatarDataBR } from "@/motor";
import type { FuncionarioDto } from "@/servicos/dto";

type Props = {
  clienteId: string;
  funcionario: FuncionarioDto | null;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
};

function Conteudo({ clienteId, funcionario }: { clienteId: string; funcionario: FuncionarioDto }) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [justificada, setJustificada] = useState(true);
  const [pendente, iniciar] = useTransition();
  const [removendo, iniciarRemocao] = useTransition();

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await adicionarAusenciaAcao({
        clienteId,
        funcionarioId: funcionario.id,
        inicio,
        fim: fim || inicio,
        motivo,
        justificada,
      });
      if (r.ok) {
        toast.success("Ausência adicionada.");
        setInicio("");
        setFim("");
        setMotivo("");
      } else toast.error(r.erro);
    });
  }

  function remover(ausenciaId: string) {
    iniciarRemocao(async () => {
      const r = await removerAusenciaAcao(clienteId, ausenciaId);
      if (r.ok) toast.success("Ausência removida.");
      else toast.error(r.erro);
    });
  }

  return (
    <div className="space-y-5">
      {funcionario.ausencias.length === 0 ? (
        <p className="text-sm text-texto-suave">Nenhuma ausência cadastrada.</p>
      ) : (
        <ul className="divide-y divide-borda rounded-lg border border-borda">
          {funcionario.ausencias.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="numero font-mono">
                {formatarDataBR(a.inicio)}
                {a.fim !== a.inicio && ` a ${formatarDataBR(a.fim)}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-texto-suave">{a.motivo ?? "Sem motivo"}</span>
              <Badge variant={a.justificada ? "secondary" : "destructive"}>{a.justificada ? "Justificada" : "Falta"}</Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover ausência de ${formatarDataBR(a.inicio)}`}
                onClick={() => remover(a.id)}
                disabled={removendo}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={adicionar} className="space-y-3 rounded-lg border border-borda p-3.5" noValidate>
        <h3 className="font-display text-sm font-semibold">Nova ausência</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="a-inicio">Início</Label>
            <Input id="a-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="numero font-mono" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-fim">Fim</Label>
            <Input id="a-fim" type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} className="numero font-mono" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-motivo">Motivo</Label>
          <Input id="a-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="Férias, atestado…" />
        </div>
        <div className="flex items-center gap-3">
          <Switch id="a-justificada" checked={justificada} onCheckedChange={setJustificada} />
          <Label htmlFor="a-justificada">Ausência justificada</Label>
        </div>
        <Button type="submit" disabled={pendente || inicio === ""}>
          {pendente ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Adicionar
        </Button>
      </form>
    </div>
  );
}

export function AusenciasDialogo({ clienteId, funcionario, aberto, aoMudarAberto }: Props) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ausências{funcionario ? `: ${funcionario.nome}` : ""}</DialogTitle>
          <DialogDescription>Férias, atestados e faltas. Registradas por período, para a escala considerar esses dias.</DialogDescription>
        </DialogHeader>
        {funcionario && <Conteudo clienteId={clienteId} funcionario={funcionario} />}
      </DialogContent>
    </Dialog>
  );
}
