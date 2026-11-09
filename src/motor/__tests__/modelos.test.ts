import { describe, expect, it } from "vitest";
import {
  buscarModelo,
  ErroMotor,
  funcionamentoDoModelo,
  gerarTurnos,
  intervaloPadrao,
  listarModelos,
  MODELO_PADRAO,
  modeloPorId,
  regrasDoModelo,
  validarRegras,
  minutosTrabalhados,
  formatarHora,
} from "..";

describe("modelos de funcionamento", () => {
  it("há os 7 modelos esperados, com o shopping como padrão", () => {
    expect(listarModelos().map((m) => m.id)).toEqual(["shopping", "shopping-domingo-reduzido", "comercio", "supermercado", "administrativo", "restaurante", "24-horas"]);
    expect(MODELO_PADRAO).toBe("shopping");
  });

  it("todos cabem na regra final (40h e 2 folgas), usam o intervalo da CLT e não têm turno curto", () => {
    const ids = new Set<string>();
    for (const m of listarModelos()) {
      expect(ids.has(m.id), `id repetido: ${m.id}`).toBe(false);
      ids.add(m.id);
      // 5 dias (2 folgas) de jornada inteira cabem nas 40h.
      expect(m.jornadaMin * 5, m.id).toBeLessThanOrEqual(40 * 60);
      expect(m.jornadaMin, m.id).toBeLessThanOrEqual(regrasDoModelo(m.id).jornadaDiariaMaxMin);
      expect(m.intervaloMin, m.id).toBe(intervaloPadrao(m.jornadaMin));
      const f = funcionamentoDoModelo(m.id);
      const turnos = gerarTurnos(f.janelas, f.jornadaMin, f.intervaloMin);
      expect(turnos.length, m.id).toBeGreaterThan(0);
      for (const t of turnos) expect(minutosTrabalhados(t.horario), `${m.id}: turno mais curto que a jornada`).toBe(m.jornadaMin);
      expect(() => validarRegras(regrasDoModelo(m.id))).not.toThrow();
    }
  });

  it("os turnos do README: shopping 10:00–16:15 e 15:45–22:00; 24h em 3 turnos", () => {
    const f = funcionamentoDoModelo("shopping");
    const t = gerarTurnos(f.janelas, f.jornadaMin, f.intervaloMin);
    expect(t.map((x) => `${formatarHora(x.horario.inicioMin)}–${formatarHora(x.horario.fimMin)}`)).toEqual(["10:00–16:15", "15:45–22:00"]);
    const super_ = funcionamentoDoModelo("supermercado");
    expect(gerarTurnos(super_.janelas, super_.jornadaMin, super_.intervaloMin).map((x) => `${formatarHora(x.horario.inicioMin)}–${formatarHora(x.horario.fimMin)}`)).toEqual(["07:00–16:00", "13:00–22:00"]);
    const vinte4 = funcionamentoDoModelo("24-horas");
    expect(gerarTurnos(vinte4.janelas, vinte4.jornadaMin, vinte4.intervaloMin).map((x) => `${formatarHora(x.horario.inicioMin)}–${formatarHora(x.horario.fimMin)}`)).toEqual(["06:00–15:00", "13:30–22:30", "21:00–06:00"]);
  });

  it("domingos seguidos: 2 no comércio de fim de semana, 0 onde fecha, 6 nas 24h", () => {
    expect(regrasDoModelo("shopping").domingosSeguidosMax).toBe(2);
    expect(regrasDoModelo("comercio").domingosSeguidosMax).toBe(0);
    expect(regrasDoModelo("administrativo").domingosSeguidosMax).toBe(0);
    expect(regrasDoModelo("24-horas").domingosSeguidosMax).toBe(6);
    expect(regrasDoModelo("shopping")).toMatchObject({ cargaSemanalMaxMin: 44 * 60, jornadaDiariaMaxMin: 480, descansoEntreJornadasMin: 660, maxDiasConsecutivos: 6, folgasSemanaisMin: 1, inicioSemana: "segunda" });
  });

  it("id desconhecido", () => {
    expect(buscarModelo("nao-existe")).toBeUndefined();
    expect(() => modeloPorId("nao-existe")).toThrow(ErroMotor);
    expect(() => regrasDoModelo("nao-existe")).toThrow(ErroMotor);
  });

  it("o funcionamento devolvido é uma cópia", () => {
    const f = funcionamentoDoModelo("shopping");
    f.janelas.length = 0;
    expect(funcionamentoDoModelo("shopping").janelas).toHaveLength(7);
  });
});
