import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { sok, type Lage } from "../src/sok.js";
import { stang } from "../src/lagring.js";

// Två mått per söksätt, på de k första träffarna:
// fakta@k: andel frågor där svaret (en känd sträng) finns i de hämtade delarna.
//          Det är det som avgör om modellen kan svara rätt.
// källa@k: andel frågor där den kanoniska källfilen finns bland träffarna.
// MRR:     1/rang för första delen som innehåller svaret, i snitt.
type Fall = { fraga: string; svar: string[]; kalla: string[] };
type Variant = { namn: string; lage: Lage; enkel: boolean };

const fil = existsSync(new URL("./fragor.local.json", import.meta.url))
  ? new URL("./fragor.local.json", import.meta.url)
  : new URL("./fragor.exempel.json", import.meta.url);
const fall: Fall[] = JSON.parse(await readFile(fil, "utf8"));
const K = Number(process.env.K ?? 5);
const norm = (s: string) => s.replace(/[  ]/g, " ").toLowerCase();

const varianter: Variant[] = [
  { namn: "nyckelord", lage: "nyckelord", enkel: true },
  { namn: "vektor", lage: "vektor", enkel: true },
  { namn: "hybrid (RRF)", lage: "hybrid", enkel: true },
  { namn: "hybrid + källvikt", lage: "hybrid", enkel: false },
];

const resultat: Record<string, { fakta: number; kalla: number; mrr: number; ms: number; missar: string[] }> = {};
for (const v of varianter) {
  let fakta = 0, kalla = 0, mrr = 0, ms = 0;
  const missar: string[] = [];
  for (const f of fall) {
    const t0 = Date.now();
    const traffar = await sok(f.fraga, { n: K, lage: v.lage, enkel: v.enkel });
    ms += Date.now() - t0;
    const rang = traffar.findIndex((t) => f.svar.some((s) => norm(`${t.rubrik} ${t.text}`).includes(norm(s))));
    if (rang >= 0) { fakta++; mrr += 1 / (rang + 1); } else missar.push(f.fraga);
    if (traffar.some((t) => f.kalla.includes(t.fil))) kalla++;
  }
  const n = fall.length;
  resultat[v.namn] = { fakta: fakta / n, kalla: kalla / n, mrr: mrr / n, ms: Math.round(ms / n), missar };
}

const p = (x: number) => `${(x * 100).toFixed(0)} %`.padStart(6);
console.log(`\n${fall.length} frågor, k = ${K}\n`);
console.log(`${"söksätt".padEnd(20)}fakta@${K}  källa@${K}  MRR    ms`);
for (const [namn, r] of Object.entries(resultat)) {
  console.log(`${namn.padEnd(20)}${p(r.fakta)}   ${p(r.kalla)}   ${r.mrr.toFixed(2)}  ${r.ms}`);
}
const sista = resultat["hybrid + källvikt"];
if (sista.missar.length) console.log(`\nmissar (hybrid + källvikt):\n  ${sista.missar.join("\n  ")}`);
writeFileSync(new URL(`./resultat-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url), JSON.stringify({ k: K, fragor: fall.length, resultat }, null, 2));
await stang();
