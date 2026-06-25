const base = "http://localhost:3333";

const health = await fetch(`${base}/api/health`);
const healthJson = await health.json();

if (!health.ok || !healthJson.ok) {
  throw new Error("Health check falhou.");
}

const config = await fetch(`${base}/api/config`);
const configJson = await config.json();

if (!config.ok || configJson.name !== "Nexus Connections") {
  throw new Error("Config check falhou.");
}

console.log("SMOKE OK", healthJson.name, configJson.shortName);
