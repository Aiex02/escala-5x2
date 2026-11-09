import { exportarMes } from "@/servicos/exportacao";
import { ErroAgenda } from "@/servicos/planejamento";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(_requisicao: Request, contexto: RouteContext<"/api/clientes/[clienteId]/escala/[ano]/[mes]/exportar">) {
  const { clienteId, ano, mes } = await contexto.params;
  try {
    const arquivo = await exportarMes(clienteId, Number(ano), Number(mes));
    return new Response(Buffer.from(arquivo.conteudo), {
      headers: {
        "Content-Type": TIPO_XLSX,
        "Content-Disposition": `attachment; filename="${arquivo.nome}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erro) {
    if (erro instanceof ErroAgenda) {
      return Response.json({ erro: erro.message }, { status: 400 });
    }
    console.error("Falha ao exportar a escala:", erro);
    return Response.json({ erro: "Não foi possível exportar a escala." }, { status: 500 });
  }
}
