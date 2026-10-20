const fallbackModels = [
  { family: "fable", id: "claude-fable-5-1", name: "Fable 5.1" },
  { family: "sonnet", id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { family: "opus", id: "claude-opus-5-5", name: "Opus 5.5" },
];

function version(model) {
  const named = model.name.match(/\d+(?:\.\d+)*/)?.[0];
  return named ? named.split(".").map(Number) : (model.id.match(/\b\d{1,3}\b/g) || []).map(Number);
}

export function latestModels(catalog) {
  return fallbackModels.map(fallback => {
    const family = new RegExp(`\\b${fallback.family}\\b`, "i");
    const choices = catalog.filter(model => family.test(`${model.id} ${model.name}`));
    choices.sort((a, b) => {
      const av = version(a), bv = version(b);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const difference = (bv[i] || 0) - (av[i] || 0);
        if (difference) return difference;
      }
      return 0;
    });
    return choices[0] || fallback;
  });
}
