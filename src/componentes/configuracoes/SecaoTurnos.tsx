"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { criarTurnoAcao, removerTurnoAcao, salvarTurnoAcao } from "@/acoes/configuracao";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/componentes/ui/alert-dialog";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { CORES_TURNO, proximaCorLivre } from "@/lib/coresTurno";
import { cn } from "@/lib/utils";
import { formatarHora, tentarAnalisarHora, tentarCriarHorario } from "@/motor";
import type { TurnoDto } from "@/servicos/dto";
import { CampoNumerico } from "./CampoNumerico";
import { DIAS_SEMANA } from "./utilFuncionamento";

/** Campos editáveis de um turno, já na unidade interna (minutos, máscara de dias). */
type DadosTurno = {
  nome: string;
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  cor: string;
  efetivoMinimo: number;
  diasSemana: number;
};

const TODOS_OS_DIAS = 0b1111111;

/** Mesmas regras de `criarHorario` no servidor, para avisar antes de enviar. */
function erroDoHorario(inicioMin: number | null, fimMin: number | null, intervaloMin: number): string | null {
  if (inicioMin === null || fimMin === null) return "Informe entrada e saída.";
  if (inicioMin === fimMin) return "Entrada e saída não podem ser iguais.";
  if (!tentarCriarHorario(inicioMin, fimMin, intervaloMin)) return "O intervalo não cabe na jornada.";
  return null;
}

function EditorTurno({
  idBase,
  inicial,
  rotuloEnviar,
  aoEnviar,
  acoesExtras,
}: {
  idBase: string;
  inicial: DadosTurno;
  rotuloEnviar: string;
  aoEnviar: (dados: DadosTurno) => Promise<void>;
  acoesExtras?: React.ReactNode;
}) {
  const [nome, setNome] = useState(inicial.nome);
  const [inicio, setInicio] = useState(formatarHora(inicial.inicioMin));
  const [fim, setFim] = useState(formatarHora(inicial.fimMin));
  const [intervalo, setIntervalo] = useState(inicial.intervaloMin);
  const [cor, setCor] = useState(inicial.cor.toUpperCase());
  const [efetivo, setEfetivo] = useState(inicial.efetivoMinimo);
  const [diasSemana, setDiasSemana] = useState(inicial.diasSemana);
  const [pendente, iniciar] = useTransition();

  const inicioMin = tentarAnalisarHora(inicio);
  const fimMin = tentarAnalisarHora(fim);
  const erroHorario = erroDoHorario(inicioMin, fimMin, intervalo);
  const alterado =
    nome.trim() !== inicial.nome ||
    inicioMin !== inicial.inicioMin ||
    fimMin !== inicial.fimMin ||
    intervalo !== inicial.intervaloMin ||
    cor !== inicial.cor.toUpperCase() ||
    efetivo !== inicial.efetivoMinimo ||
    diasSemana !== inicial.diasSemana;
  const valido = nome.trim().length > 0 && erroHorario === null && diasSemana > 0;

  function enviar() {
    if (inicioMin === null || fimMin === null || !valido) return;
    iniciar(async () => {
      await aoEnviar({
        nome: nome.trim(),
        inicioMin,
        fimMin,
        intervaloMin: intervalo,
        cor,
        efetivoMinimo: efetivo,
        diasSemana,
      });
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`nome-${idBase}`}>Nome do turno</Label>
          <Input id={`nome-${idBase}`} value={nome} maxLength={60} disabled={pendente} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`inicio-${idBase}`}>Entrada</Label>
          <Input id={`inicio-${idBase}`} type="time" value={inicio} disabled={pendente} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`fim-${idBase}`}>Saída</Label>
          <Input id={`fim-${idBase}`} type="time" value={fim} disabled={pendente} onChange={(e) => setFim(e.target.value)} />
        </div>
        <CampoNumerico
          id={`intervalo-${idBase}`}
          rotulo="Intervalo"
          valor={intervalo}
          aoMudar={setIntervalo}
          sufixo="min"
          min={0}
          max={120}
          desabilitado={pendente}
        />
      </div>
      {erroHorario && (
        <p role="alert" className="text-xs text-critico">
          {erroHorario}
        </p>
      )}

      <fieldset className="space-y-2" disabled={pendente}>
        <legend className="text-sm font-medium">Dias em que funciona</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DIAS_SEMANA.map((dia, i) => (
            <label key={dia} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(diasSemana & (1 << i)) !== 0}
                onChange={() => setDiasSemana((atuais) => atuais ^ (1 << i))}
                className="size-4 accent-acento"
              />
              {dia}
            </label>
          ))}
        </div>
        {diasSemana === 0 && <p className="text-xs text-critico">Selecione ao menos um dia.</p>}
      </fieldset>

      <div className="flex flex-wrap items-end gap-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Cor</legend>
          <div role="radiogroup" aria-label={`Cor do turno ${nome}`} className="flex gap-1.5">
            {CORES_TURNO.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cor === c}
                aria-label={c}
                disabled={pendente}
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
          id={`efetivo-${idBase}`}
          rotulo="Efetivo mínimo"
          valor={efetivo}
          aoMudar={setEfetivo}
          sufixo="pessoas"
          min={0}
          max={99}
          dica="0 = sem mínimo"
          desabilitado={pendente}
        />

        <div className="flex flex-wrap gap-2">
          <Button onClick={enviar} disabled={!alterado || !valido || pendente} variant={alterado ? "default" : "outline"}>
            {pendente && <Loader2 className="animate-spin" aria-hidden />}
            {rotuloEnviar}
          </Button>
          {acoesExtras}
        </div>
      </div>
    </div>
  );
}

function BotaoRemover({ clienteId, turno }: { clienteId: string; turno: TurnoDto }) {
  const [pendente, iniciar] = useTransition();

  function remover() {
    iniciar(async () => {
      const r = await removerTurnoAcao(clienteId, turno.id);
      if (!r.ok) toast.error(r.erro);
      else if (r.dados.arquivado) toast.success(`Turno ${turno.nome} arquivado: as escalas já geradas continuam como estão.`);
      else toast.success(`Turno ${turno.nome} removido.`);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={pendente}>
          {pendente ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          Remover
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover o turno {turno.nome}?</AlertDialogTitle>
          <AlertDialogDescription>
            O turno deixa de ser usado nas próximas escalas. Se ele já aparece em alguma escala gerada, é arquivado para preservar o
            histórico; caso contrário, é excluído.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remover}>
            Remover turno
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinhaTurno({ clienteId, turno }: { clienteId: string; turno: TurnoDto }) {
  async function salvar(dados: DadosTurno): Promise<void> {
    const r = await salvarTurnoAcao({ clienteId, turnoId: turno.id, ...dados });
    if (r.ok) toast.success(`Turno ${dados.nome} salvo.`);
    else toast.error(r.erro);
  }

  return (
    <li className="rounded-lg border border-borda bg-superficie p-4">
      <EditorTurno
        idBase={turno.id}
        inicial={turno}
        rotuloEnviar="Salvar turno"
        aoEnviar={salvar}
        acoesExtras={<BotaoRemover clienteId={clienteId} turno={turno} />}
      />
    </li>
  );
}

function NovoTurno({ clienteId, turnos, aoFechar }: { clienteId: string; turnos: TurnoDto[]; aoFechar: () => void }) {
  const inicial: DadosTurno = {
    nome: "",
    inicioMin: 8 * 60,
    fimMin: 16 * 60,
    intervaloMin: 60,
    cor: proximaCorLivre(turnos.map((t) => t.cor)),
    efetivoMinimo: 1,
    diasSemana: TODOS_OS_DIAS,
  };

  async function criar(dados: DadosTurno): Promise<void> {
    const r = await criarTurnoAcao({ clienteId, ...dados });
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    toast.success(`Turno ${dados.nome} criado.`);
    aoFechar();
  }

  return (
    <section aria-labelledby="novo-turno-titulo" className="rounded-lg border border-dashed border-borda bg-superficie p-4">
      <h3 id="novo-turno-titulo" className="mb-3 font-display font-semibold">
        Novo turno
      </h3>
      <EditorTurno
        idBase="novo"
        inicial={inicial}
        rotuloEnviar="Criar turno"
        aoEnviar={criar}
        acoesExtras={
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        }
      />
    </section>
  );
}

/** Chave que muda quando o servidor devolve outro valor, para o formulário recomeçar dele. */
const chaveTurno = (t: TurnoDto) =>
  [t.id, t.nome, t.inicioMin, t.fimMin, t.intervaloMin, t.cor, t.efetivoMinimo, t.diasSemana].join("|");

export function SecaoTurnos({ clienteId, turnos }: { clienteId: string; turnos: TurnoDto[] }) {
  const [criando, setCriando] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-suave">
        Edite nome, horários, intervalo, dias de funcionamento, cor e efetivo mínimo de cada turno, crie turnos novos ou remova os que
        não usa mais. As mudanças valem para as próximas escalas: os dias já gerados guardam o horário com que foram escalados.
      </p>
      <div role="note" className="flex gap-2 rounded-lg border border-atencao/40 bg-atencao/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-atencao" aria-hidden />
        <p>
          <strong>Atenção:</strong> ao clicar em &quot;Salvar funcionamento&quot; (aba Funcionamento e jornada), os turnos são
          recalculados a partir dos horários de funcionamento. Turnos criados aqui ou com horário alterado à mão são excluídos (ou
          arquivados, se já têm escala), e nome e dias dos demais voltam ao calculado. Faça os ajustes de turno depois de salvar o
          funcionamento.
        </p>
      </div>

      {turnos.length === 0 && !criando && (
        <p className="text-sm text-texto-suave">Nenhum turno ativo. Salve o funcionamento para gerar os turnos ou crie um à mão.</p>
      )}
      <ul className="space-y-3">
        {turnos.map((t) => (
          <LinhaTurno key={chaveTurno(t)} clienteId={clienteId} turno={t} />
        ))}
      </ul>

      {criando ? (
        <NovoTurno clienteId={clienteId} turnos={turnos} aoFechar={() => setCriando(false)} />
      ) : (
        <Button variant="outline" onClick={() => setCriando(true)}>
          <Plus aria-hidden /> Novo turno
        </Button>
      )}
    </div>
  );
}
