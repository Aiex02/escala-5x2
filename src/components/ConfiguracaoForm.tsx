import { useMemo, useState, type FormEvent } from "react";
import { Check, Save, SlidersHorizontal, Store } from "lucide-react";
import { api, mensagemErro } from "../api/client";
import type { Configuracao, ConfiguracaoEntrada, DiaFuncionamento, ModeloFuncionamento } from "../api/types";
import { pluralizar } from "../util/formato";
import { intervaloSugerido, previaTurnos } from "../util/funcionamento";
import { regrasAoAplicar, resumoSemanal } from "../util/modelosFuncionamento";
import { Botao } from "./base/Botao";
import { Campo } from "./base/Campo";
import { lerNumero } from "./base/CampoNumero";
import { Selecao, type OpcaoSelecao } from "./base/Selecao";
import { CabecalhoPrevia, PreviaTurnosLista } from "./ConfiguracaoBlocos";
import { ConfiguracaoPersonalizada } from "./ConfiguracaoPersonalizada";
import { avisosDe, camposDe, camposDoModelo, normalizarDia, paraEntrada, regrasDeCampos, temErro, validar, type Campos } from "./configuracaoCampos";
import { ModeloResumo } from "./ModeloResumo";
import { useNotificar } from "./Toast";
import { Alerta, Selo } from "./ui";

interface Props {
  clienteId: number;
  /** Configuração salva: modelo em uso (ou nulo, se personalizada), regras, funcionamento e turnos. */
  configuracao: Configuracao;
  /** Modelos do backend. */
  modelos: readonly ModeloFuncionamento[];
  onSalvo: (configuracao: Configuracao) => void;
}

type Modo = "modelo" | "personalizado";

const PERSONALIZADO = "personalizado";

/** O intervalo já foge da sugestão da CLT para a jornada: foi ajustado à mão e não deve ser trocado sozinho. */
function intervaloAjustado(c: Campos): boolean {
  const jornada = lerNumero(c.jornada);
  return !(jornada > 0) || lerNumero(c.intervalo) !== intervaloSugerido(jornada);
}

/**
 * Funcionamento e jornada: o modelo escolhido define horário, jornada e regras (já alinhados à EC 141) e
 * tudo aparece só para leitura. Para fugir do padrão, "Personalizado" libera os campos, com avisos
 * onde a configuração se afasta da lei ou da CLT.
 */
export function ConfiguracaoForm({ clienteId, configuracao, modelos, onSalvo }: Props) {
  const notificar = useNotificar();
  const modeloSalvo = modelos.find((m) => m.id === configuracao.modelo) ?? null;
  // Campos da configuração salva: base para saber o que mudou.
  const salvos = useMemo(() => camposDe(configuracao.funcionamento, configuracao.regras), [configuracao.funcionamento, configuracao.regras]);

  const [modo, setModo] = useState<Modo>(modeloSalvo ? "modelo" : "personalizado");
  const [modeloId, setModeloId] = useState(modeloSalvo?.id ?? modelos[0]?.id ?? "");
  const [campos, setCampos] = useState<Campos>(salvos);
  // Enquanto o intervalo não foi mexido à mão, mudar a jornada sugere o intervalo da CLT.
  const [intervaloTocado, setIntervaloTocado] = useState(() => intervaloAjustado(salvos));
  const [salvando, setSalvando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);

  const modeloExibido = modelos.find((m) => m.id === modeloId) ?? null;
  const emModelo = modo === "modelo" && modeloExibido !== null;
  const modeloPendente = emModelo && modeloExibido.id !== configuracao.modelo;
  // Regras que valem com o modelo: as salvas, se ele já está em uso; senão as que passam a valer ao aplicá-lo.
  const regrasModelo = modeloExibido ? (modeloExibido.id === configuracao.modelo ? configuracao.regras : regrasAoAplicar(modeloExibido, configuracao.regras)) : null;

  // ----- Personalizado -----
  const erros = validar(campos);
  const invalido = temErro(erros);
  const rascunho = JSON.stringify(campos) !== JSON.stringify(salvos);
  // Salvar sobre um modelo em uso vira personalizado mesmo sem mudar nenhum valor.
  const alteradoPersonalizado = rascunho || configuracao.modelo !== null;
  const jornadaHoras = lerNumero(campos.jornada);
  const intervaloMin = lerNumero(campos.intervalo);
  const horarioValido =
    !erros.geral && !erros.dias.some((d) => d.abre || d.fecha) && jornadaHoras >= 1 && jornadaHoras <= 12 && Number.isInteger(intervaloMin) && intervaloMin >= 0 && intervaloMin <= 120;
  const previaPersonalizada = horarioValido ? previaTurnos(campos.dias.map(normalizarDia), jornadaHoras, intervaloMin) : null;
  const regrasCampos = regrasDeCampos(campos);
  const resumo = horarioValido && !erros.carga && !erros.folgas && !erros.publicacao ? resumoSemanal({ dias: campos.dias, jornadaHoras }, regrasCampos) : null;
  // Turnos de dias com horário menor que a jornada: quem os faz fica abaixo das horas previstas.
  const curtos = (previaPersonalizada ?? []).filter((t) => t.trabalhadasMin < Math.round(jornadaHoras * 60));
  const avisos = avisosDe(campos, resumo, curtos);

  const previa = emModelo ? previaTurnos(modeloExibido.dias, modeloExibido.jornadaHoras, modeloExibido.intervaloMin) : previaPersonalizada;

  const opcoesModelo: OpcaoSelecao<string>[] = [...modelos.map((m) => ({ valor: m.id, rotulo: m.nome })), { valor: PERSONALIZADO, rotulo: "Personalizado" }];
  const emUso = emModelo ? !modeloPendente : configuracao.modelo === null && !rascunho;

  function preencher(novos: Campos) {
    setCampos(novos);
    setIntervaloTocado(intervaloAjustado(novos));
  }

  /** Personalizar a partir do modelo à vista: os campos começam com os valores dele. */
  function personalizar() {
    setErroServidor(null);
    if (modeloExibido) preencher(camposDoModelo(modeloExibido, configuracao.regras));
    setModo("personalizado");
  }

  function escolher(valor: string) {
    setErroServidor(null);
    if (valor !== PERSONALIZADO) {
      // Voltar a um modelo não pergunta nada: só mostra a prévia até "Aplicar modelo". O que estava sendo editado fica guardado.
      setModeloId(valor);
      setModo("modelo");
      return;
    }
    if (modo === "personalizado") return;
    // Volta ao que estava sendo editado; sem edições, parte do modelo à vista (ou da configuração personalizada salva).
    if (!rascunho && configuracao.modelo !== null && modeloExibido) preencher(camposDoModelo(modeloExibido, configuracao.regras));
    setModo("personalizado");
  }

  function mudarCampos(mudanca: Partial<Campos>) {
    setErroServidor(null);
    setCampos((c) => ({ ...c, ...mudanca }));
  }

  function mudarDia(indice: number, mudanca: Partial<DiaFuncionamento>) {
    setErroServidor(null);
    setCampos((c) => ({ ...c, dias: c.dias.map((d, i) => (i === indice ? { ...d, ...mudanca } : d)) }));
  }

  function copiarSegunda() {
    const segunda = campos.dias[0];
    if (!segunda?.aberto) return;
    setErroServidor(null);
    setCampos((c) => ({ ...c, dias: c.dias.map((d) => (d.aberto ? { ...d, abre: segunda.abre, fecha: segunda.fecha } : d)) }));
  }

  function mudarJornada(jornada: string) {
    setErroServidor(null);
    const horas = lerNumero(jornada);
    setCampos((c) => ({ ...c, jornada, intervalo: !intervaloTocado && horas > 0 ? String(intervaloSugerido(horas)) : c.intervalo }));
  }

  function mudarIntervalo(intervalo: string) {
    setErroServidor(null);
    setIntervaloTocado(true);
    setCampos((c) => ({ ...c, intervalo }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    let entrada: ConfiguracaoEntrada;
    if (emModelo) {
      if (!modeloPendente) return;
      entrada = { modelo: modeloExibido.id, regras: null, funcionamento: null };
    } else {
      if (invalido || !alteradoPersonalizado) return;
      entrada = paraEntrada(campos);
    }
    setSalvando(true);
    setErroServidor(null);
    try {
      const nova = await api.salvarConfiguracao(clienteId, entrada);
      const aplicado = modelos.find((m) => m.id === nova.modelo) ?? null;
      preencher(camposDe(nova.funcionamento, nova.regras));
      setModo(aplicado ? "modelo" : "personalizado");
      if (aplicado) setModeloId(aplicado.id);
      onSalvo(nova);
      const turnos = pluralizar(nova.turnos.length, "turno gerado", "turnos gerados");
      notificar.sucesso(
        aplicado ? `Modelo “${aplicado.nome}” aplicado: ${turnos}. Gere os meses de novo para aplicar.` : `Configuração personalizada salva: ${turnos}. Gere os meses de novo para aplicar.`,
      );
    } catch (err) {
      setErroServidor(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  }

  const avisosTurnos = avisos.filter((a) => a.campo === "turnos");
  const textoRodape = emModelo
    ? modeloPendente
      ? "Modelo ainda não aplicado: é só uma prévia."
      : "Tudo salvo."
    : invalido
      ? "Corrija os campos em destaque para salvar."
      : alteradoPersonalizado
        ? "Há alterações não salvas."
        : "Tudo salvo.";

  return (
    <form className="painel" onSubmit={(e) => void salvar(e)} noValidate aria-labelledby="titulo-configuracao">
      <header className="painel-cab">
        <div>
          <h2 id="titulo-configuracao">Funcionamento e jornada</h2>
          <p className="painel-sub">
            O modelo define de uma vez o horário, a jornada e as regras, já de acordo com o fim da escala 6x1 (EC 141); os turnos e as escalas seguem dele. Ao gerar um mês, todos os
            funcionários ativos são redistribuídos entre os turnos.
          </p>
        </div>
      </header>

      <div className="painel-corpo funcionamento">
        <div className="modelo-escolha">
          <span className="modelo-icone" aria-hidden="true">
            <Store size={20} strokeWidth={1.8} />
          </span>
          <Campo
            id="config-modelo"
            rotulo="Modelo"
            className="modelo-campo"
            dica={emModelo ? modeloExibido.descricao : "Horários, jornada e regras definidos à mão. Escolha um modelo para voltar ao padrão do fim da escala 6x1."}
          >
            <Selecao<string> id="config-modelo" valor={emModelo ? modeloExibido.id : PERSONALIZADO} opcoes={opcoesModelo} desabilitado={salvando} onMudar={escolher} />
          </Campo>
          <span className="modelo-estado">
            {emUso ? <Selo tom="sucesso">Em uso</Selo> : <Selo tom="atencao">{emModelo ? "Prévia: ainda não aplicado" : "Não salvo"}</Selo>}
          </span>
        </div>
        {!emModelo && (
          <Alerta tipo="info">
            Personalizado: você define horários, jornada e regras. Os avisos ao lado de cada campo mostram onde a configuração foge da CLT ou do fim da escala 6x1 (EC 141); eles não impedem
            de salvar.
            {configuracao.modelo !== null && ` Ao salvar, este cliente deixa de seguir o modelo${modeloSalvo ? ` “${modeloSalvo.nome}”` : ""}.`}
          </Alerta>
        )}
      </div>

      {emModelo && regrasModelo ? (
        <ModeloResumo modelo={modeloExibido} regras={regrasModelo} />
      ) : (
        <ConfiguracaoPersonalizada
          campos={campos}
          erros={erros}
          avisos={avisos}
          resumo={resumo}
          fases={regrasCampos.fases}
          onMudar={mudarCampos}
          onMudarDia={mudarDia}
          onMudarJornada={mudarJornada}
          onMudarIntervalo={mudarIntervalo}
          onCopiarSegunda={copiarSegunda}
        />
      )}

      <div className="painel-corpo painel-corpo-dividido">
        <CabecalhoPrevia titulo={emModelo ? "Turnos do modelo" : "Turnos que serão gerados"} total={previa ? previa.length : null} />
        {previa ? <PreviaTurnosLista previa={previa} turnos={configuracao.turnos} /> : <p className="texto-suave">Corrija os campos acima para ver os turnos.</p>}
        {avisosTurnos.map((a) => (
          <Alerta key={a.texto} tipo={a.tipo}>
            {a.texto}
          </Alerta>
        ))}
        {erroServidor && <Alerta tipo="erro">{erroServidor}</Alerta>}
      </div>

      <footer className="painel-rodape">
        <span className="texto-suave">{textoRodape}</span>
        <div className="rodape-acoes">
          {emModelo ? (
            <>
              <Botao icone={SlidersHorizontal} onClick={personalizar} disabled={salvando} data-dica="Libera todos os campos, começando pelos valores deste modelo">
                Personalizar
              </Botao>
              {modeloPendente && (
                <Botao type="submit" variante="primario" icone={Check} carregando={salvando}>
                  Aplicar modelo
                </Botao>
              )}
            </>
          ) : (
            <>
              {avisos.length > 0 && (
                <Selo tom="atencao" dica="Onde a configuração foge da lei ou da CLT. Os avisos não impedem de salvar.">
                  {pluralizar(avisos.length, "aviso", "avisos")}
                </Selo>
              )}
              <Botao type="submit" variante="primario" icone={Save} carregando={salvando} disabled={!alteradoPersonalizado || invalido}>
                Salvar
              </Botao>
            </>
          )}
        </div>
      </footer>
    </form>
  );
}
