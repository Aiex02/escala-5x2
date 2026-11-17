"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { salvarFuncionarioAcao } from "@/acoes/funcionarios";
import { Button } from "@/componentes/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/componentes/ui/dialog";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/componentes/ui/select";
import { Switch } from "@/componentes/ui/switch";
import type { FuncionarioDto, PreferenciaDto } from "@/servicos/dto";

type Props = {
  clienteId: string;
  /** `null` = novo funcionário. */
  funcionario: FuncionarioDto | null;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  /** Cargos já usados na equipe, sugeridos ao digitar. */
  cargosExistentes?: string[];
};

const SEM_PREFERENCIA = "nenhuma";

/** "37,5" ou "36h" → minutos; vazio → `null`; inválido → `undefined`. */
function lerHoras(texto: string): number | null | undefined {
  const t = texto.trim().toLowerCase().replace(/\s*h$/, "");
  if (t === "") return null;
  const n = /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : Number.NaN;
  return Number.isFinite(n) ? Math.round(n * 60) : undefined;
}

const HORAS_NAO_TRABALHADAS_MAX = 744;

function horasParaTexto(min: number | null): string {
  return min === null ? "" : String(min / 60).replace(".", ",");
}

function Formulario({
  clienteId,
  funcionario,
  aoFechar,
  cargosExistentes,
}: {
  clienteId: string;
  funcionario: FuncionarioDto | null;
  aoFechar: () => void;
  cargosExistentes: string[];
}) {
  const [matricula, setMatricula] = useState(funcionario?.matricula ?? "");
  const [nome, setNome] = useState(funcionario?.nome ?? "");
  const [cargo, setCargo] = useState(funcionario?.cargo ?? "");
  const [secao, setSecao] = useState(funcionario?.secao ?? "");
  const [ctps, setCtps] = useState(funcionario?.ctps ?? "");
  const [preferencia, setPreferencia] = useState<PreferenciaDto | typeof SEM_PREFERENCIA>(funcionario?.preferencia ?? SEM_PREFERENCIA);
  const [carga, setCarga] = useState(horasParaTexto(funcionario?.cargaSemanalMin ?? null));
  const [naoTrabalhadas, setNaoTrabalhadas] = useState(horasParaTexto(funcionario?.horasNaoTrabalhadasMin ?? null));
  const [ativo, setAtivo] = useState(funcionario?.ativo ?? true);
  const [isento, setIsento] = useState(funcionario?.isentoEc141 ?? false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cargaMin = lerHoras(carga);
    if (cargaMin === undefined) {
      setErro("Carga semanal inválida: use horas, como 36 ou 37,5.");
      return;
    }
    const naoTrabalhadasMin = lerHoras(naoTrabalhadas);
    if (naoTrabalhadasMin === undefined || (naoTrabalhadasMin !== null && naoTrabalhadasMin > HORAS_NAO_TRABALHADAS_MAX * 60)) {
      setErro(`Horas não trabalhadas inválidas: use horas de 0 a ${HORAS_NAO_TRABALHADAS_MAX}, como 4, 4,5 ou 4h.`);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarFuncionarioAcao({
        clienteId,
        id: funcionario?.id ?? null,
        matricula,
        nome,
        cargo,
        secao,
        ctps,
        cargaSemanalMin: cargaMin,
        preferencia: preferencia === SEM_PREFERENCIA ? null : preferencia,
        ativo,
        isentoEc141: isento,
        horasNaoTrabalhadasMin: naoTrabalhadasMin,
      });
      if (!r.ok) {
        setErro(r.erro);
        toast.error(r.erro);
        return;
      }
      toast.success(funcionario ? "Funcionário atualizado." : "Funcionário adicionado.");
      aoFechar();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="f-nome">Nome</Label>
          <Input id="f-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-matricula">Matrícula</Label>
          <Input id="f-matricula" value={matricula} onChange={(e) => setMatricula(e.target.value)} maxLength={30} className="numero font-mono" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-cargo">Cargo</Label>
          <Input id="f-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} maxLength={60} list="cargos-existentes" />
          <datalist id="cargos-existentes">
            {cargosExistentes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-secao">Seção</Label>
          <Input id="f-secao" value={secao} onChange={(e) => setSecao(e.target.value)} maxLength={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-ctps">CTPS</Label>
          <Input id="f-ctps" value={ctps} onChange={(e) => setCtps(e.target.value)} maxLength={40} className="numero font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-preferencia">Preferência de turno</Label>
          <Select value={preferencia} onValueChange={(v) => setPreferencia(v as PreferenciaDto | typeof SEM_PREFERENCIA)}>
            <SelectTrigger id="f-preferencia" className="w-full">
              <SelectValue>
                {preferencia === "MANHA" ? "Manhã" : preferencia === "TARDE" ? "Tarde" : preferencia === "NOITE" ? "Noite" : "Sem preferência"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_PREFERENCIA}>Sem preferência</SelectItem>
              <SelectItem value="MANHA">Manhã</SelectItem>
              <SelectItem value="TARDE">Tarde</SelectItem>
              <SelectItem value="NOITE">Noite</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-carga">Carga semanal (horas)</Label>
          <Input
            id="f-carga"
            inputMode="decimal"
            value={carga}
            onChange={(e) => setCarga(e.target.value)}
            className="numero font-mono"
            placeholder="Regra do cliente"
            aria-describedby="f-carga-dica"
          />
          <p id="f-carga-dica" className="text-xs text-texto-suave">
            Deixe vazio para seguir a regra do cliente.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-nao-trabalhadas">Horas não trabalhadas</Label>
          <Input
            id="f-nao-trabalhadas"
            inputMode="decimal"
            value={naoTrabalhadas}
            onChange={(e) => setNaoTrabalhadas(e.target.value)}
            className="numero font-mono"
            placeholder="Não informado"
            aria-describedby="f-nao-trabalhadas-dica"
          />
          <p id="f-nao-trabalhadas-dica" className="text-xs text-texto-suave">
            Ex.: 4, 4,5 ou 4h (até {HORAS_NAO_TRABALHADAS_MAX}h). Só informativo; não altera a escala.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-borda p-3.5">
        <div className="flex items-center gap-3">
          <Switch id="f-ativo" checked={ativo} onCheckedChange={setAtivo} />
          <Label htmlFor="f-ativo">Ativo (entra nas escalas novas)</Label>
        </div>
        <div className="flex items-start gap-3">
          <Switch id="f-isento" checked={isento} onCheckedChange={setIsento} className="mt-0.5" />
          <div className="space-y-0.5">
            <Label htmlFor="f-isento">Fora das regras de jornada da EC 141</Label>
            <p className="text-xs text-texto-suave">
              Para empregado público ou de nível superior com remuneração acima de 2,5 vezes o teto do RGPS. Valem só as regras da
              empresa.
            </p>
          </div>
        </div>
      </div>

      {erro && (
        <p role="alert" className="text-sm text-critico">
          {erro}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={aoFechar} disabled={pendente}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pendente}>
          {pendente && <Loader2 className="animate-spin" aria-hidden />}
          {funcionario ? "Salvar" : "Adicionar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function FuncionarioDialogo({ clienteId, funcionario, aberto, aoMudarAberto, cargosExistentes = [] }: Props) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{funcionario ? "Editar funcionário" : "Adicionar funcionário"}</DialogTitle>
          <DialogDescription>A matrícula identifica a pessoa dentro deste cliente.</DialogDescription>
        </DialogHeader>
        {/* A key recria o formulário (e seus rascunhos) a cada abertura. */}
        {aberto && <Formulario key={funcionario?.id ?? "novo"} clienteId={clienteId} funcionario={funcionario}
            aoFechar={() => aoMudarAberto(false)}
            cargosExistentes={cargosExistentes}
          />}
      </DialogContent>
    </Dialog>
  );
}
