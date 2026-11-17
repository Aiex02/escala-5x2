type AnoMes = { ano: number; mes: number };

/** A partir deste mês (outubro) o ano está nos "meses finais" e a sidebar oferece o ano seguinte. */
export const MES_INICIO_FIM_DE_ANO = 10;
/** Mesmo teto de ano aceito pela página e pelas ações da escala. */
const ANO_MAXIMO = 2100;

/**
 * Ano seguinte ao último da árvore de escalas, quando esse último ano já chegou aos meses
 * finais: pelo calendário (se é o ano corrente) ou pelo último mês gerado. `null` = ainda não oferecer.
 */
export function proximoAnoACriar(meses: readonly AnoMes[], hoje: AnoMes): number | null {
  const ultimoAno = meses.reduce((maior, { ano }) => Math.max(maior, ano), hoje.ano);
  const ultimoMesGerado = meses.reduce((maior, { ano, mes }) => (ano === ultimoAno ? Math.max(maior, mes) : maior), 0);
  const nosMesesFinais =
    (ultimoAno === hoje.ano && hoje.mes >= MES_INICIO_FIM_DE_ANO) || ultimoMesGerado >= MES_INICIO_FIM_DE_ANO;
  if (!nosMesesFinais) return null;
  const proximo = ultimoAno + 1;
  return proximo > ANO_MAXIMO ? null : proximo;
}
