"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { criarClienteAcao } from "@/acoes/clientes";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";
import { PreviaTurnos } from "@/componentes/configuracoes/PreviaTurnos";
import {
  colorirTurnosGerados,
  resumirHorario,
  type TurnoParaExibir,
} from "@/componentes/configuracoes/utilFuncionamento";
import { cn } from "@/lib/utils";
import { MODELO_PADRAO, descreverJornada, gerarTurnos, listarModelos } from "@/motor";

const PERSONALIZADO = "personalizado";

type Opcao = {
  id: string;
  nome: string;
  descricao: string;
  horario: string;
  jornada: string;
  turnos: TurnoParaExibir[];
};

function montarOpcoes(): Opcao[] {
  const modelos = listarModelos().map<Opcao>((m) => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    horario: resumirHorario(m.janelas),
    jornada: descreverJornada(m.jornadaMin, m.intervaloMin),
    turnos: colorirTurnosGerados(gerarTurnos(m.janelas, m.jornadaMin, m.intervaloMin)),
  }));
  return modelos;
}

export function NovoClienteForm() {
  const router = useRouter();
  const [passo, setPasso] = useState<1 | 2>(1);
  const [nome, setNome] = useState("");
  const [modelo, setModelo] = useState<string>(MODELO_PADRAO);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const opcoes = useMemo(() => montarOpcoes(), []);

  function avancar(e: React.FormEvent) {
    e.preventDefault();
    if (passo === 1) {
      if (nome.trim().length < 2) {
        setErroNome("Informe o nome do cliente (ao menos 2 letras).");
        return;
      }
      setErroNome(null);
      setPasso(2);
      return;
    }
    iniciar(async () => {
      const r = await criarClienteAcao({ nome, modelo: modelo === PERSONALIZADO ? null : modelo });
      if (!r.ok) {
        toast.error(r.erro);
        if (/nome/i.test(r.erro)) {
          setErroNome(r.erro);
          setPasso(1);
        }
        return;
      }
      toast.success("Cliente criado. Agora cadastre os funcionários.");
      router.push(`/clientes/${r.dados.id}/funcionarios`);
    });
  }

  return (
    <form onSubmit={avancar} className="mx-auto flex w-full max-w-4xl flex-col gap-6" noValidate>
      <ol className="flex items-center gap-3 text-sm" aria-label="Passos">
        {[
          { n: 1, rotulo: "Cliente" },
          { n: 2, rotulo: "Funcionamento" },
        ].map(({ n, rotulo }) => (
          <li key={n} className="flex items-center gap-2" aria-current={passo === n ? "step" : undefined}>
            <span
              className={cn(
                "numero grid size-6 place-items-center rounded-full border text-xs font-medium",
                passo >= n ? "border-acento bg-acento text-acento-texto" : "border-borda text-texto-suave",
              )}
            >
              {passo > n ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <span className={passo === n ? "font-medium" : "text-texto-suave"}>{rotulo}</span>
            {n === 1 && <span className="mx-1 h-px w-8 bg-borda" aria-hidden />}
          </li>
        ))}
      </ol>

      {passo === 1 ? (
        <section className="max-w-md space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Qual é o nome do cliente?</h2>
            <p className="text-sm text-texto-suave">Pode ser a loja, a empresa ou a unidade para a qual você monta a escala.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nome-cliente">Nome do cliente</Label>
            <Input
              id="nome-cliente"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErroNome(null);
              }}
              autoFocus
              maxLength={80}
              placeholder="Ex.: Cafeteria do Shopping"
              aria-invalid={erroNome !== null}
              aria-describedby={erroNome ? "erro-nome" : undefined}
            />
            {erroNome && (
              <p id="erro-nome" role="alert" className="text-sm text-critico">
                {erroNome}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Como {nome.trim() || "o cliente"} funciona?</h2>
            <p className="text-sm text-texto-suave">
              O modelo define o horário de abertura, a jornada e os turnos. Você pode ajustar tudo depois em Configurações.
            </p>
          </div>
          <div role="radiogroup" aria-label="Modelo de funcionamento" className="grid gap-3 md:grid-cols-2">
            {opcoes.map((o) => {
              const selecionado = modelo === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => setModelo(o.id)}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border bg-superficie p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    selecionado ? "border-acento bg-acento/6 ring-1 ring-acento" : "border-borda hover:border-texto-suave/50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-display font-semibold">{o.nome}</span>
                    {selecionado && <Check className="ml-auto size-4 text-acento" aria-hidden />}
                  </span>
                  <span className="text-sm text-texto-suave">{o.descricao}</span>
                  <span className="numero font-mono text-xs">{o.horario}</span>
                  <span className="text-xs text-texto-suave">Jornada: {o.jornada}</span>
                  <PreviaTurnos turnos={o.turnos} compacta />
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={modelo === PERSONALIZADO}
              onClick={() => setModelo(PERSONALIZADO)}
              className={cn(
                "flex flex-col gap-2 rounded-lg border border-dashed bg-superficie p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                modelo === PERSONALIZADO ? "border-acento bg-acento/6 ring-1 ring-acento" : "border-borda hover:border-texto-suave/50",
              )}
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-acento" aria-hidden />
                <span className="font-display font-semibold">Personalizado</span>
                {modelo === PERSONALIZADO && <Check className="ml-auto size-4 text-acento" aria-hidden />}
              </span>
              <span className="text-sm text-texto-suave">
                Defina você mesmo os dias, os horários, a jornada e as regras. Começa com o horário de Shopping para você
                ajustar em Configurações.
              </span>
            </button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-2">
        {passo === 2 && (
          <Button type="button" variant="outline" onClick={() => setPasso(1)} disabled={pendente}>
            <ArrowLeft aria-hidden /> Voltar
          </Button>
        )}
        <Button type="submit" size="lg" disabled={pendente}>
          {pendente ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Criando…
            </>
          ) : passo === 1 ? (
            <>
              Continuar <ArrowRight aria-hidden />
            </>
          ) : (
            "Criar cliente"
          )}
        </Button>
      </div>
    </form>
  );
}
