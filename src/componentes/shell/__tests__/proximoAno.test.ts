import { describe, expect, it } from "vitest";
import { proximoAnoACriar } from "../proximoAno";

const ate = (ano: number, ultimoMes: number) => Array.from({ length: ultimoMes }, (_, i) => ({ ano, mes: i + 1 }));

describe("proximoAnoACriar", () => {
  it("não oferece em setembro sem meses gerados", () => {
    expect(proximoAnoACriar([], { ano: 2026, mes: 9 })).toBeNull();
  });

  it.each([10, 11, 12])("oferece o ano seguinte em %i sem meses gerados", (mes) => {
    expect(proximoAnoACriar([], { ano: 2026, mes })).toBe(2027);
  });

  it("não oferece se o último mês gerado é setembro e hoje é março", () => {
    expect(proximoAnoACriar(ate(2026, 9), { ano: 2026, mes: 3 })).toBeNull();
  });

  it("oferece se o gestor adiantou até outubro", () => {
    expect(proximoAnoACriar(ate(2026, 10), { ano: 2026, mes: 3 })).toBe(2027);
  });

  it("não oferece quando o ano seguinte já foi iniciado e ainda está no começo", () => {
    expect(proximoAnoACriar([...ate(2026, 12), { ano: 2027, mes: 1 }], { ano: 2026, mes: 11 })).toBeNull();
  });

  it("oferece o ano depois do último gerado quando ele chegou a dezembro", () => {
    expect(proximoAnoACriar(ate(2027, 12), { ano: 2026, mes: 2 })).toBe(2028);
  });

  it("ignora anos antigos com dezembro gerado", () => {
    expect(proximoAnoACriar(ate(2024, 12), { ano: 2026, mes: 6 })).toBeNull();
  });

  it("respeita o teto de 2100", () => {
    expect(proximoAnoACriar([], { ano: 2100, mes: 12 })).toBeNull();
  });

  it("não depende da ordem de meses", () => {
    const desordenado = [{ ano: 2026, mes: 10 }, { ano: 2026, mes: 2 }, { ano: 2026, mes: 6 }];
    expect(proximoAnoACriar(desordenado, { ano: 2026, mes: 3 })).toBe(2027);
  });
});
