import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Botao } from "./base/Botao";

interface Props {
  children: ReactNode;
}

interface Estado {
  erro: Error | null;
}

/** Evita tela branca: mostra a falha e permite tentar de novo. */
export class ErrorBoundary extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("Erro na interface:", erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="estado-vazio" role="alert">
        <h2>Esta tela parou de responder</h2>
        <div className="estado-vazio-texto">{this.state.erro.message}</div>
        <div className="estado-vazio-acao">
          <Botao variante="primario" icone={RotateCw} onClick={() => this.setState({ erro: null })}>
            Tentar de novo
          </Botao>
        </div>
      </div>
    );
  }
}
