"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Info, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { salvarFuncionamentoAcao } from "@/acoes/configuracao";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { Switch } from "@/componentes/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/componentes/ui/select";
import type { ConfiguracaoDto, RegrasEmpresaDto } from "@/servicos/dto";
import {
  avisosFuncionamento,
  buscarModelo,
  descreverJornada,
  errosDasRegras,
  etapasEc141,
  formatarHora,
  funcionamentoDoModelo,
  gerarTurnos,
  intervaloPadrao,
  listarModelos,
  regrasDoModelo,
  tentarAnalisarHora,
  type JanelaDia,
  type RegrasCarga,
  type TurnoGerado,
} from "@/motor";
import { CampoNumerico } from "./CampoNumerico";
import { PreviaTurnos } from "./PreviaTurnos";
import { DIAS_SEMANA, colorirTurnosGerados, resumirHorario } from "./utilFuncionamento";

const PERSONALIZADO = "personalizado";

type LinhaDia = { aberto: boolean; abre: string; fecha: string };

interface Valores {
  linhas: LinhaDia[];
  jornadaMin: number;
  intervaloMin: number;
  regras: RegrasEmpresaDto;
}

function linhasDeJanelas(janelas: readonly JanelaDia[]): LinhaDia[] {
  return Array.from({ length: 7 }, (_, dia) => {
    const j = janelas.find((x) => x.dia === dia);
    return j
      ? { aberto: true, abre: formatarHora(j.abreMin), fecha: formatarHora(j.fechaMin) }
      : { aberto: false, abre: "10:00", fecha: "22:00" };
  });
}

/** Converte as linhas do editor em janelas; `erro` descreve o primeiro horário inválido. */
function janelasDeLinhas(linhas: readonly LinhaDia[]): { janelas: JanelaDia[]; erro: string | null } {
  const janelas: JanelaDia[] = [];
  for (const [dia, l] of linhas.entries()) {
    if (!l.aberto) continue;
    const abre = tentarAnalisarHora(l.abre);
    const fecha = tentarAnalisarHora(l.fecha);
    if (abre === null || fecha === null) {
      return { janelas, erro: `${DIAS_SEMANA[dia]}: informe a abertura e o fechamento (HH:MM).` };
    }
    janelas.push({ dia, abreMin: abre, fechaMin: fecha });
  }
  return { janelas, erro: null };
}

function valoresDoModelo(id: string): Valores {
  const f = funcionamentoDoModelo(id);
  return { linhas: linhasDeJanelas(f.janelas), jornadaMin: f.jornadaMin, intervaloMin: f.intervaloMin, regras: regrasDoModelo(id) };
}

export function SecaoFuncionamento({ config }: { config: ConfiguracaoDto }) {
  const [pendente, iniciar] = useTransition();
  const [modelo, setModelo] = useState<string | null>(config.modelo);
  const [personalizado, setPersonalizado] = useState<Valores>({
    linhas: linhasDeJanelas(config.janelas),
    jornadaMin: config.jornadaMin,
    intervaloMin: config.intervaloMin,
    regras: config.regras,
  });

  const travado = modelo !== null;
  const valores = useMemo(() => (modelo !== null ? valoresDoModelo(modelo) : personalizado), [modelo, personalizado]);
  const { linhas, jornadaMin, intervaloMin, regras } = valores;
  const definicao = modelo !== null ? buscarModelo(modelo) : undefined;

  function mudarModelo(id: string) {
    if (id === PERSONALIZADO) {
      // Parte do que estava na tela para o usuário só ajustar.
      setPersonalizado(valores);
      setModelo(null);
    } else {
      setModelo(id);
    }
  }
  const editar = (parcial: Partial<Valores>) => setPersonalizado({ ...valores, ...parcial });
  const editarRegras = (parcial: Partial<RegrasEmpresaDto>) => editar({ regras: { ...regras, ...parcial } });
  const editarLinha = (dia: number, parcial: Partial<LinhaDia>) =>
    editar({ linhas: linhas.map((l, i) => (i === dia ? { ...l, ...parcial } : l)) });

  const regrasMotor: RegrasCarga = regras;
  const { janelas, erro: erroJanelas } = janelasDeLinhas(linhas);

  // Pré-visualização ao vivo: turnos gerados e avisos.
  const analise = useMemo(() => {
    if (erroJanelas) return { erro: erroJanelas, gerados: [] as TurnoGerado[], avisos: [] };
    const errosRegras = errosDasRegras(regrasMotor);
    if (errosRegras.length > 0) return { erro: errosRegras[0] ?? null, gerados: [] as TurnoGerado[], avisos: [] };
    try {
      const gerados = gerarTurnos(janelas, jornadaMin, intervaloMin);
      const avisos = avisosFuncionamento({
        regras: regrasMotor,
        regime: config.regime === "EC141" ? etapasEc141(config.publicacao) : [],
        janelas,
        jornadaMin,
        intervaloMin,
      });
      return { erro: null, gerados, avisos };
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "Configuração inválida.", gerados: [] as TurnoGerado[], avisos: [] };
    }
  }, [erroJanelas, regrasMotor, janelas, jornadaMin, intervaloMin, config.regime, config.publicacao]);

  const previaTurnos = useMemo(() => colorirTurnosGerados(analise.gerados, config.turnos), [analise.gerados, config.turnos]);
  const sugestao = intervaloPadrao(jornadaMin);

  function salvar() {
    iniciar(async () => {
      const r = await salvarFuncionamentoAcao({ clienteId: config.clienteId, modelo, regras, janelas, jornadaMin, intervaloMin });
      if (r.ok) toast.success(`Funcionamento salvo. ${r.dados.turnos} ${r.dados.turnos === 1 ? "turno" : "turnos"} no total.`);
      else toast.error(r.erro);
    });
  }

  const opcoesModelo = listarModelos();

  return (
    <div className="space-y-6">
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="modelo">Modelo de funcionamento</Label>
        <Select value={modelo ?? PERSONALIZADO} onValueChange={mudarModelo}>
          <SelectTrigger id="modelo" className="w-full">
            <SelectValue>{definicao ? definicao.nome : "Personalizado"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {opcoesModelo.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.nome}
              </SelectItem>
            ))}
            <SelectItem value={PERSONALIZADO}>Personalizado</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-texto-suave">
          {definicao ? definicao.descricao : "Você define os dias, os horários, a jornada e as regras."}
        </p>
      </div>

      {travado && (
        <div className="flex items-start gap-2 rounded-lg border border-borda bg-superficie p-3.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-texto-suave" aria-hidden />
          <div className="space-y-1">
            <p>
              <span className="font-medium">Horário:</span> <span className="numero font-mono">{resumirHorario(janelas)}</span>
            </p>
            <p>
              <span className="font-medium">Jornada:</span> {descreverJornada(jornadaMin, intervaloMin)}
            </p>
            <p className="text-texto-suave">
              Os campos abaixo seguem o modelo. Escolha &quot;Personalizado&quot; para alterá-los.
            </p>
          </div>
        </div>
      )}

      <fieldset className="space-y-3" disabled={travado}>
        <legend className="font-display text-base font-semibold">Horário de funcionamento</legend>
        <ul className="divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {linhas.map((l, dia) => (
            <li key={dia} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5">
              <div className="flex w-36 items-center gap-2.5">
                <Switch
                  id={`dia-${dia}`}
                  checked={l.aberto}
                  onCheckedChange={(v) => editarLinha(dia, { aberto: v })}
                  aria-label={`${DIAS_SEMANA[dia]}: abre`}
                />
                <Label htmlFor={`dia-${dia}`} className="font-medium">
                  {DIAS_SEMANA[dia]}
                </Label>
              </div>
              {l.aberto ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor={`abre-${dia}`} className="sr-only">
                    {DIAS_SEMANA[dia]}: abertura
                  </Label>
                  <Input
                    id={`abre-${dia}`}
                    type="time"
                    className="numero w-28 font-mono"
                    value={l.abre}
                    onChange={(e) => editarLinha(dia, { abre: e.target.value })}
                  />
                  <span className="text-sm text-texto-suave">até</span>
                  <Label htmlFor={`fecha-${dia}`} className="sr-only">
                    {DIAS_SEMANA[dia]}: fechamento
                  </Label>
                  <Input
                    id={`fecha-${dia}`}
                    type="time"
                    className="numero w-28 font-mono"
                    value={l.fecha}
                    onChange={(e) => editarLinha(dia, { fecha: e.target.value })}
                  />
                  {l.abre === l.fecha && <span className="text-xs text-texto-suave">24 horas</span>}
                </div>
              ) : (
                <span className="text-sm text-texto-suave">Fechado</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-texto-suave">Abertura igual ao fechamento significa 24 horas. Fechar antes de abrir atravessa a meia-noite.</p>
      </fieldset>

      <fieldset className="space-y-3" disabled={travado}>
        <legend className="font-display text-base font-semibold">Jornada</legend>
        <div className="flex flex-wrap gap-6">
          <CampoNumerico
            id="jornada"
            rotulo="Jornada diária"
            valor={jornadaMin}
            aoMudar={(v) => editar({ jornadaMin: v })}
            sufixo="min"
            desabilitado={travado}
            dica={`Entre 60 e 720 minutos (${descreverJornada(jornadaMin, intervaloMin)}).`}
          />
          <div className="space-y-1.5">
            <CampoNumerico
              id="intervalo"
              rotulo="Intervalo"
              valor={intervaloMin}
              aoMudar={(v) => editar({ intervaloMin: v })}
              sufixo="min"
              desabilitado={travado}
            />
            {!travado && sugestao !== intervaloMin && (
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => editar({ intervaloMin: sugestao })}>
                Usar o padrão da CLT ({sugestao} min)
              </Button>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={travado}>
        <legend className="font-display text-base font-semibold">Regras da empresa</legend>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <CampoNumerico id="r-carga" rotulo="Carga semanal máxima" valor={regras.cargaSemanalMaxMin} escala={60} sufixo="h" aoMudar={(v) => editarRegras({ cargaSemanalMaxMin: v })} desabilitado={travado} />
          <CampoNumerico id="r-jornada" rotulo="Jornada diária máxima" valor={regras.jornadaDiariaMaxMin} escala={60} sufixo="h" aoMudar={(v) => editarRegras({ jornadaDiariaMaxMin: v })} desabilitado={travado} />
          <CampoNumerico id="r-descanso" rotulo="Descanso entre jornadas" valor={regras.descansoEntreJornadasMin} escala={60} sufixo="h" aoMudar={(v) => editarRegras({ descansoEntreJornadasMin: v })} desabilitado={travado} />
          <CampoNumerico id="r-consecutivos" rotulo="Máx. de dias seguidos" valor={regras.maxDiasConsecutivos} sufixo="dias" aoMudar={(v) => editarRegras({ maxDiasConsecutivos: v })} desabilitado={travado} />
          <CampoNumerico id="r-folgas" rotulo="Folgas semanais mínimas" valor={regras.folgasSemanaisMin} sufixo="por semana" aoMudar={(v) => editarRegras({ folgasSemanaisMin: v })} desabilitado={travado} />
          <CampoNumerico id="r-domingos" rotulo="Domingos seguidos (máx.)" valor={regras.domingosSeguidosMax} sufixo="0 = sem limite" aoMudar={(v) => editarRegras({ domingosSeguidosMax: v })} desabilitado={travado} />
          <div className="space-y-1.5">
            <Label htmlFor="r-inicio">Início da semana</Label>
            <Select
              value={regras.inicioSemana}
              onValueChange={(v) => editarRegras({ inicioSemana: v === "domingo" ? "domingo" : "segunda" })}
              disabled={travado}
            >
              <SelectTrigger id="r-inicio" className="w-40">
                <SelectValue>{regras.inicioSemana === "domingo" ? "Domingo" : "Segunda-feira"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="segunda">Segunda-feira</SelectItem>
                <SelectItem value="domingo">Domingo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>

      <section className="space-y-3" aria-live="polite">
        <h3 className="font-display text-base font-semibold">Turnos que serão gerados</h3>
        {analise.erro ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-critico">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {analise.erro}
          </p>
        ) : (
          <>
            <PreviaTurnos turnos={previaTurnos} />
            {analise.avisos.length > 0 && (
              <ul className="space-y-2">
                {analise.avisos.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {a.tipo === "atencao" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-atencao" aria-label="Atenção" />
                    ) : (
                      <Info className="mt-0.5 size-4 shrink-0 text-texto-suave" aria-label="Informação" />
                    )}
                    <span>{a.texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="text-xs text-texto-suave">
          Ao salvar, turnos com o mesmo horário continuam (com cor e efetivo mínimo); os que deixam de existir são arquivados se já
          têm escala gerada, ou excluídos.
        </p>
      </section>

      <Button onClick={salvar} disabled={pendente || analise.erro !== null}>
        {pendente && <Loader2 className="animate-spin" aria-hidden />}
        Salvar funcionamento
      </Button>
    </div>
  );
}
