export function evaluate(source, vars = {}) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_]\w*)|([-+*/%^()]))/y;
  let pos = 0;
  const src = String(source);
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`syntax error at ${pos}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) {
      if (/^\./.test(src.slice(pos))) throw new Error(`syntax error at ${pos}`);
      toks.push({ t: 'num', v: Number(m[1]) });
    } else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] });
    else toks.push({ t: m[3] });
  }
  let i = 0;
  const peek = () => toks[i]?.t;
  const eat = (t) => { if (peek() !== t) throw new Error(`syntax error: expected ${t}`); i++; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = toks[i++].t; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const term = () => {
    let v = unary();
    while (['*', '/', '%'].includes(peek())) {
      const op = toks[i++].t; const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new Error('division by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const unary = () => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { const b = primary(); if (peek() === '^') { i++; return b ** unary(); } return b; };
  const primary = () => {
    const tk = toks[i];
    if (!tk) throw new Error('syntax error: unexpected end');
    if (tk.t === 'num') { i++; return tk.v; }
    if (tk.t === 'id') { i++; if (!(tk.v in vars)) throw new Error(`unknown variable: ${tk.v}`); return vars[tk.v]; }
    if (tk.t === '(') { i++; const v = expr(); eat(')'); return v; }
    throw new Error(`syntax error: unexpected ${tk.t}`);
  };
  const v = expr();
  if (i !== toks.length) throw new Error('syntax error: trailing input');
  return v;
}
