const subscriptDigits = '₀₁₂₃₄₅₆₇₈₉';

/** Typeset atom counts while preserving the original formula used by other tools. */
export function renderChemicalFormula(host: HTMLElement, formula: string) {
  // Convert ASCII counts only for simple formulas where digits cannot be a charge or isotope.
  const display = /^(?:[A-Z][a-z]?\d*|[()[\]]\d*)+$/.test(formula)
    ? formula.replace(/\d/g, digit => subscriptDigits[Number(digit)])
    : formula;
  const parts: (string | HTMLElement)[] = [];
  let cursor = 0;
  for (const match of display.matchAll(/([A-Z][a-z]?|[)\]])?([₀-₉]+)/g)) {
    const [countWithSymbol, symbol = '', count] = match;
    parts.push(display.slice(cursor, match.index));
    const group = document.createElement('span');
    group.className = 'chemical-formula-count';
    const sub = document.createElement('sub');
    sub.textContent = count.replace(/[₀-₉]/g, digit => String(subscriptDigits.indexOf(digit)));
    group.append(symbol, sub);
    parts.push(group);
    cursor = match.index + countWithSymbol.length;
  }
  if (!parts.length) {
    host.textContent = formula;
    return;
  }
  host.replaceChildren(...parts, display.slice(cursor));
}
