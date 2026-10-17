// Where the person's prompts sit relative to the transcript's viewport, from the engine's onScreen reports.

// The person's own prompts; notifications and other agents' messages are not stops.
export const ownOrigins = new Set(["composer", "bridge"]);

export function emptyState() {
  return { order: [], shown: new Map(), above: new Map(), landed: null, rows: [], rowVisibility: new Map() };
}

export function trackRow(state, id, seen) {
  if (!state.rows.includes(id)) state.rows.push(id);
  if (seen !== undefined) state.rowVisibility.set(id, seen);
}

export function atBottom(state) {
  const last = state.rowVisibility.get(state.rows.at(-1));
  return !!last && last.last >= last.of - 1;
}

export function track(state, id, seen) {
  if (!state.order.includes(id)) state.order.push(id);
  if (seen) {
    state.shown.set(id, seen);
    const index = state.order.indexOf(id);
    state.order.forEach((other, i) => { if (i !== index) state.above.set(other, i < index); });
    state.above.set(id, seen.first > 0);
  } else if (seen === null && state.shown.has(id)) {
    // A prompt whose top had scrolled away left upward; one cut at the bottom left downward.
    const before = state.shown.get(id);
    state.shown.delete(id);
    state.above.set(id, before.first > 0 || before.last >= before.of - 1);
  }
}

// The prompts to try for ▲ (step -1) or ▼ (step 1), nearest first: a stop the transcript
// refuses (rewound, cleared) gives way to the next one the same way.
export function candidates(state, step) {
  const { order, shown, above, landed } = state;
  // A short conversation can show several prompts while its end is already in
  // view. Advancing from the first visible prompt would scroll backward there.
  if (atBottom(state)) {
    if (step > 0) return [];
    const latest = order.at(-1);
    const end = shown.get(latest)?.first === 0 ? order.length - 1 : order.length;
    return order.slice(0, end).reverse();
  }
  const reference = landed && shown.has(landed) ? landed : order.find(id => shown.has(id));
  let up, down;
  if (reference) {
    const index = order.indexOf(reference);
    up = shown.get(reference).first > 0 ? index : index - 1;
    down = index + 1;
  } else {
    // A prompt never reported in view (new rows push it off before it draws) counts as above:
    // the viewport sits just before the first prompt known to lie below it.
    const firstBelow = order.findIndex(id => above.get(id) === false);
    up = (firstBelow >= 0 ? firstBelow : order.length) - 1;
    down = up + 1;
  }
  return step < 0 ? order.slice(0, up + 1).reverse() : order.slice(down);
}
