import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Läser .env bredvid projektet utan extra beroenden.
const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFil = join(rot, ".env");
if (existsSync(envFil)) {
  for (const rad of readFileSync(envFil, "utf8").split("\n")) {
    const m = rad.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const v = (namn: string, standard: string) => process.env[namn] ?? standard;

export const konfig = {
  kalla: v("MINNE_KALLA", "./vault"),
  uteslut: v("MINNE_UTESLUT", "_arkiv").split(",").map((s) => s.trim()).filter(Boolean),
  pg: v("MINNE_PG", "postgres://localhost:5432/minne"),
  llmUrl: v("MINNE_LLM_URL", "http://127.0.0.1:1234/v1"),
  embedModell: v("MINNE_EMBED_MODELL", "text-embedding-nomic-embed-text-v1.5"),
  chattModell: v("MINNE_CHATT_MODELL", "qwen/qwen3.5-9b"),
  port: Number(v("MINNE_PORT", "4300")),
  index: "vault",
  dimension: 768,
};
