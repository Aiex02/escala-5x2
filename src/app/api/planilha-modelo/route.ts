import { connection } from "next/server";
import { gerarModeloPlanilha } from "@/excel";

/** Planilha modelo de funcionários para download. */
export async function GET(): Promise<Response> {
  // Gera a cada requisição (o arquivo traz data de criação, que não pode ser fixada no build).
  await connection();
  const bytes = await gerarModeloPlanilha();
  return new Response(new Blob([new Uint8Array(bytes)]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-funcionarios.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
