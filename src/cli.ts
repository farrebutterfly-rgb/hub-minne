import { fraga } from "./agent.js";
import { stang } from "./lagring.js";

const q = process.argv.slice(2).join(" ");
if (!q) {
  console.log('Använd: npm run fraga -- "din fråga"');
  process.exit(1);
}
const r = await fraga(q);
console.log(`\n${r.svar}\n`);
for (const k of r.kallor) console.log(`  [${k.nr}] ${k.fil}  (${k.via.join("+")})`);
console.log(`\n${(r.ms / 1000).toFixed(1)} s`);
await stang();
