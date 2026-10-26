//! Normalização de texto para comparar cabeçalhos, valores de célula e dias.

/// Minúsculas, sem acentos e só com letras/dígitos: "Matrícula " → "matricula",
/// "intervalo_min" → "intervalomin".
pub(crate) fn chave(texto: &str) -> String {
    sem_acentos(texto)
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

/// Minúsculas e sem acentos, preservando os demais caracteres.
pub(crate) fn sem_acentos(texto: &str) -> String {
    texto
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            outro => outro,
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn normaliza_cabecalhos() {
        assert_eq!(chave(" Matrícula "), "matricula");
        assert_eq!(chave("Intervalo (min)"), "intervalomin");
        assert_eq!(chave("dias_disponíveis"), "diasdisponiveis");
        assert_eq!(chave("MANHÃ"), "manha");
    }
}
