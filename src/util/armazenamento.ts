// Acesso seguro ao localStorage: o app precisa funcionar mesmo sem ele
// (modo privado, webview restrito, armazenamento cheio...).

export function lerArmazenado(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function gravarArmazenado(chave: string, valor: string | null): void {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento disponível: segue sem lembrar
  }
}
