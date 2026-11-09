"use client";

import { useState, useTransition } from "react";
import { Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { salvarRegimeAcao } from "@/acoes/configuracao";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Switch } from "@/componentes/ui/switch";
import { ehValida, PUBLICACAO_EC141_PADRAO } from "@/motor";
import type { ConfiguracaoDto } from "@/servicos/dto";
import { LinhaDoTempoEc141 } from "./LinhaDoTempoEc141";

export function SecaoRegime({ config }: { config: ConfiguracaoDto }) {
  const [ativo, setAtivo] = useState(config.regime === "EC141");
  const [publicacao, setPublicacao] = useState(config.publicacao);
  const [pendente, iniciar] = useTransition();
  const dataValida = ehValida(publicacao);
  const alterado = ativo !== (config.regime === "EC141") || publicacao !== config.publicacao;

  function salvar() {
    iniciar(async () => {
      const r = await salvarRegimeAcao({ clienteId: config.clienteId, regime: ativo ? "EC141" : "LIVRE", publicacao });
      if (r.ok) toast.success("Regime salvo. Gere o mês de novo para aplicar as novas regras.");
      else toast.error(r.erro);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-borda bg-superficie p-4">
        <Switch id="regime" checked={ativo} onCheckedChange={setAtivo} className="mt-0.5" />
        <div className="space-y-1">
          <Label htmlFor="regime" className="text-base font-medium">
            Aplicar o fim da escala 6x1 (EC 141/2026)
          </Label>
          <p className="text-sm text-texto-suave">
            Ligado, a escala segue a lei nas datas de cada fase: o mais restritivo entre a lei e as regras da empresa. Desligado,
            vale só o que está nas regras da empresa.
          </p>
        </div>
      </div>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="publicacao">Data de publicação</Label>
        <Input
          id="publicacao"
          type="date"
          className="numero font-mono"
          value={publicacao}
          onChange={(e) => setPublicacao(e.target.value)}
          aria-invalid={!dataValida}
          disabled={!ativo}
        />
        <p className="text-xs text-texto-suave">
          Os prazos contam dela. O padrão é {PUBLICACAO_EC141_PADRAO.split("-").reverse().join("/")}: confira no DOU.
        </p>
        {!dataValida && <p className="text-sm text-critico">Informe uma data válida.</p>}
      </div>

      <div className="space-y-2">
        <h3 className="font-display text-base font-semibold">Fases</h3>
        {dataValida ? (
          <LinhaDoTempoEc141 publicacao={publicacao} regras={config.regras} hoje={config.hoje} ativo={ativo} />
        ) : (
          <p className="text-sm text-texto-suave">Informe a data de publicação para ver as fases.</p>
        )}
        <p className="text-xs text-texto-suave">
          Cada fase já combina a lei com as regras da empresa. Na semana da virada vale a regra nova inteira.
        </p>
      </div>

      <div className="flex gap-2.5 rounded-lg border border-borda bg-superficie p-4 text-sm">
        <Scale className="mt-0.5 size-4 shrink-0 text-texto-suave" aria-hidden />
        <p className="text-texto-suave">
          <span className="font-medium text-texto">Exceções.</span> Ficam fora das regras de jornada da lei os empregados públicos e
          quem tem nível superior com remuneração acima de 2,5 vezes o teto do RGPS. Marque essas pessoas em Funcionários, no campo
          &quot;fora das regras de jornada da EC 141&quot;: para elas valem só as regras da empresa. A hora extra só entra como último recurso, na aba Cobertura e hora extra, e nunca quebra folgas nem o descanso.
        </p>
      </div>

      <Button onClick={salvar} disabled={!alterado || !dataValida || pendente}>
        {pendente && <Loader2 className="animate-spin" aria-hidden />}
        Salvar regime
      </Button>
    </div>
  );
}
