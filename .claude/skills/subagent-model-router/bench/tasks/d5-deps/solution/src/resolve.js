export function resolveOrder(packages, targets) {
  const needed = new Set();
  const state = new Map();
  const stack = [];
  const visit = (name, parent) => {
    if (!(name in packages)) throw new Error(`missing package: ${name} (required by ${parent})`);
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'active') {
      const cyc = stack.slice(stack.indexOf(name));
      throw new Error(`cycle: ${[...cyc, name].join(' -> ')}`);
    }
    state.set(name, 'active'); stack.push(name);
    for (const d of packages[name].deps) visit(d, name);
    stack.pop(); state.set(name, 'done'); needed.add(name);
  };
  for (const t of targets) visit(t, '<root>');
  const order = [], placed = new Set();
  while (placed.size < needed.size) {
    const next = [...needed].filter((n) => !placed.has(n) && packages[n].deps.every((d) => placed.has(d))).sort()[0];
    order.push(next); placed.add(next);
  }
  return order;
}
