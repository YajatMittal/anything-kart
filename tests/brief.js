// Runs the scenarios and returns one line per check.
export async function brief(opts) {
  const o = await (await import('/tests/scenarios.js?' + Date.now())).run(opts);
  return Object.entries(o).map(([k, v]) => `${k}: ${v}`);
}
