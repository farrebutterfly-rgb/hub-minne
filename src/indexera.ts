import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { MDocument } from "@mastra/rag";
import { konfig } from "./konfig.js";
import { badda_in_dokument } from "./modeller.js";
import { db, forbered, stang, vektorer } from "./lagring.js";

type Del = { id: string; fil: string; bolag: string; rubrik: string; text: string };

// Höj när uppdelningen ändras, så att alla filer bäddas in igen.
const UPPDELNING_VERSION = "2";

async function* markdownfiler(mapp: string): AsyncGenerator<string> {
  for (const post of await readdir(mapp, { withFileTypes: true })) {
    if (post.name.startsWith(".") || konfig.uteslut.includes(post.name)) continue;
    const full = join(mapp, post.name);
    if (post.isDirectory()) yield* markdownfiler(full);
    else if (post.name.endsWith(".md")) yield full;
  }
}

function delaFrontmatter(md: string): { titel?: string; fm?: string; text: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { text: md };
  const titel = m[1].match(/^(?:titel|title|name|bolag):\s*(.+)$/m)?.[1]?.trim();
  return { titel, fm: m[1].trim(), text: md.slice(m[0].length) };
}

// Delar upp en fil efter rubriker och lägger fil och rubrik först i varje bit,
// så att en bit som bara säger "Status: klar" ändå vet vad den handlar om.
async function delaUpp(fil: string, md: string): Promise<Del[]> {
  const { titel, fm, text } = delaFrontmatter(md);
  if (text.trim().length < 20) return [];
  const bolag = fil.split(sep)[0].startsWith("_") ? "gemensamt" : fil.split(sep)[0];
  const doc = MDocument.fromMarkdown(text, { fil });
  const bitar = await doc.chunk({
    strategy: "markdown",
    headers: [["#", "h1"], ["##", "h2"], ["###", "h3"]],
    maxSize: 1400,
    overlap: 120,
  });
  const delar = bitar.map((b, i) => {
    const md = b.metadata ?? {};
    const rubrik = [titel, md.h1, md.h2, md.h3].filter(Boolean).join(" > ");
    return { id: `${fil}#${i}`, fil, bolag, rubrik, text: b.text.trim() };
  });
  // Frontmattern (juridisk person, status, källa) blir en egen del. Där står ofta
  // de mest grundläggande fakta om ett bolag.
  if (fm && fm.length >= 20) delar.unshift({ id: `${fil}#fm`, fil, bolag, rubrik: [titel, "Om filen"].filter(Boolean).join(" > "), text: fm });
  return delar.filter((d) => d.text.length >= 20);
}

export async function indexera({ tyst = false } = {}) {
  await forbered();
  const logg = (s: string) => !tyst && console.log(s);
  const kanda = new Map<string, string>(
    (await db.query("SELECT fil, hash FROM minne_filer")).rows.map((r) => [r.fil, r.hash]),
  );
  const sedda = new Set<string>();
  let nya = 0, delar = 0;

  for await (const full of markdownfiler(konfig.kalla)) {
    const fil = relative(konfig.kalla, full);
    sedda.add(fil);
    const md = await readFile(full, "utf8");
    const hash = createHash("sha256").update(UPPDELNING_VERSION).update(md).digest("hex").slice(0, 16);
    if (kanda.get(fil) === hash) continue;

    const bitar = await delaUpp(fil, md);
    await vektorer.deleteVectors({ indexName: konfig.index, filter: { fil } }).catch(() => {});
    await db.query("DELETE FROM minne_delar WHERE fil = $1", [fil]);
    if (bitar.length) {
      const inbaddningar = await badda_in_dokument(
        bitar.map((b) => `Fil: ${b.fil}\nRubrik: ${b.rubrik || "-"}\n\n${b.text}`),
      );
      await vektorer.upsert({
        indexName: konfig.index,
        vectors: inbaddningar,
        ids: bitar.map((b) => b.id),
        metadata: bitar.map((b) => ({ fil: b.fil, bolag: b.bolag, rubrik: b.rubrik })),
      });
      for (const b of bitar) {
        await db.query(
          "INSERT INTO minne_delar (id, fil, bolag, rubrik, text) VALUES ($1,$2,$3,$4,$5)",
          [b.id, b.fil, b.bolag, b.rubrik, b.text],
        );
      }
    }
    await db.query(
      `INSERT INTO minne_filer (fil, hash, delar) VALUES ($1,$2,$3)
       ON CONFLICT (fil) DO UPDATE SET hash = excluded.hash, delar = excluded.delar, uppdaterad = now()`,
      [fil, hash, bitar.length],
    );
    nya++; delar += bitar.length;
    logg(`  ${fil}: ${bitar.length} delar`);
  }

  // Filer som försvunnit från vaulten tas bort ur minnet.
  let borta = 0;
  for (const fil of kanda.keys()) {
    if (sedda.has(fil)) continue;
    await vektorer.deleteVectors({ indexName: konfig.index, filter: { fil } }).catch(() => {});
    await db.query("DELETE FROM minne_delar WHERE fil = $1", [fil]);
    await db.query("DELETE FROM minne_filer WHERE fil = $1", [fil]);
    borta++;
  }
  const totalt = (await db.query("SELECT count(*)::int AS n FROM minne_delar")).rows[0].n;
  return { filer: sedda.size, nya, delar, borta, totalt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const start = Date.now();
  const r = await indexera();
  console.log(`minne: ${r.nya} filer uppdaterade (${r.delar} delar), ${r.borta} borttagna, ${r.totalt} delar totalt, ${((Date.now() - start) / 1000).toFixed(1)} s`);
  await stang();
}
