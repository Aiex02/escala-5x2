import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CalendarX } from "lucide-react";
import { AcoesEscala } from "@/componentes/escala/AcoesEscala";
import { BadgeFase } from "@/componentes/escala/BadgeFase";
import { BannerFaltaPessoal } from "@/componentes/escala/BannerFaltaPessoal";
import { BotaoGerar } from "@/componentes/escala/BotaoGerar";
import { EscalaCliente } from "@/componentes/escala/EscalaCliente";
import { NavegacaoMes } from "@/componentes/escala/NavegacaoMes";
import { Cabecalho } from "@/componentes/shell/Cabecalho";
import { EstadoVazio } from "@/componentes/shell/EstadoVazio";
import { Skeleton } from "@/componentes/ui/skeleton";
import { hojeISO, nomeMes } from "@/lib/datas";
import { obterAgenda } from "@/servicos/agenda";
import { ErroAgenda } from "@/servicos/planejamento";

function tituloDoMes(ano: number, mes: number): string {
  const nome = nomeMes(mes);
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/** Dados dinâmicos (params e banco) ficam dentro de Suspense por causa do Cache Components. */
async function ConteudoEscala({
  params,
}: {
  params: PageProps<"/clientes/[clienteId]/escala/[ano]/[mes]">["params"];
}) {
  const { clienteId, ano: anoTexto, mes: mesTexto } = await params;
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  if (
    !Number.isInteger(ano) ||
    ano < 2000 ||
    ano > 2100 ||
    !Number.isInteger(mes) ||
    mes < 1 ||
    mes > 12
  )
    notFound();

  let agenda;
  try {
    agenda = await obterAgenda(clienteId, ano, mes);
  } catch (erro) {
    if (erro instanceof ErroAgenda) notFound();
    throw erro;
  }
  const hoje = hojeISO();

  const bloqueio =
    agenda.funcionariosAtivos === 0
      ? "Cadastre ou importe ao menos um funcionário ativo para gerar a escala."
      : agenda.turnosAtivos === 0
        ? "Configure ao menos um turno para gerar a escala."
        : null;

  return (
    <>
      <Cabecalho
        titulo={tituloDoMes(ano, mes)}
        acoes={
          <>
            <NavegacaoMes clienteId={clienteId} ano={ano} mes={mes} />
            {agenda.fase && (
              <BadgeFase fase={agenda.fase} regraDoMes={agenda.regraDoMes} />
            )}
            <AcoesEscala
              clienteId={clienteId}
              ano={ano}
              mes={mes}
              gerado={agenda.gerado}
              bloqueioGerar={bloqueio}
              hoje={hoje}
              temMesesSeguintes={agenda.mesSeguinteGerado}
            />
          </>
        }
      />
      <div className="p-4 sm:p-6">
        {agenda.gerado ? (
          <EscalaCliente agenda={agenda} hoje={hoje} />
        ) : (
          <div className="flex flex-col gap-4">
            <BannerFaltaPessoal
              clienteId={clienteId}
              faltas={agenda.dimensionamento.faltas}
            />
            <EstadoVazio
              icone={CalendarX}
              titulo={`A escala de ${nomeMes(mes)} ainda não foi gerada`}
              descricao={
                bloqueio ??
                "O sistema distribui os turnos entre os funcionários ativos respeitando a lei, as regras da empresa, as ausências e o saldo de horas dos meses anteriores. Depois você ajusta qualquer dia no quadro."
              }
            >
              <BotaoGerar
                clienteId={clienteId}
                ano={ano}
                mes={mes}
                bloqueio={bloqueio}
                rotulo={`Gerar escala de ${nomeMes(mes)}`}
              />
            </EstadoVazio>
          </div>
        )}
      </div>
    </>
  );
}

function EsqueletoEscala() {
  return (
    <>
      <div className="flex h-14 items-center border-b border-borda px-6">
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    </>
  );
}

export default function PaginaEscala({
  params,
}: PageProps<"/clientes/[clienteId]/escala/[ano]/[mes]">) {
  return (
    <Suspense fallback={<EsqueletoEscala />}>
      <ConteudoEscala params={params} />
    </Suspense>
  );
}
