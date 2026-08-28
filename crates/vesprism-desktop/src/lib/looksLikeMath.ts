/** 有公式才拉 KaTeX。误伤（shell `$HOME`）只是多载一块，不会算错。 */
export function looksLikeMath(text: string): boolean {
  return /\$\$|\\\(|\\\[|(?:^|[^\\$])\$[^$\n]+\$/.test(text)
}
