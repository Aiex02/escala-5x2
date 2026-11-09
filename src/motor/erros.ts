/** Erro de domínio do motor: `codigo` estável para a interface, mensagem em português. */
export class ErroMotor extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroMotor";
    this.codigo = codigo;
  }
}
