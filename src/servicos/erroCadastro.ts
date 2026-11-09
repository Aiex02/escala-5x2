/** Erro de regra de negócio do cadastro, com mensagem pronta para o usuário (em português). */
export class ErroCadastro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroCadastro";
  }
}
