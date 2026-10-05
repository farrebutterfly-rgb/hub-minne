import { konfig } from "./konfig.js";
import { badda_in_fraga } from "./modeller.js";
import { db, vektorer } from "./lagring.js";

export type Traff = { id: string; fil: string; bolag: string; rubrik: string; text: string; poang: number; via: string[] };

const RRF_K = 60;

// Svenska småord som annars matchar nästan allt i fulltextsökningen.
const STOPPORD = new Set(
  "och att det som för med den till har inte var ett men jag vad vilken vilket vilka hur när där här kan ska får vill är blir från eller också efter under mot utan om sin sina sitt dem deras oss vår våra man nu bara alla mer mest många".split(" "),
);

// Källvikt: filer som är sanningen om ett bolag väger tyngre än loggar och
// nattskiftsrapporter, som ofta upprepar samma fakta i andra hand.
export function kallvikt(fil: string): number {
  if (/(^|\/)(context|status|regler|decisions|beslut|finansiering|uppgifter)\.md$/.test(fil)) return 1.6;
  if (/\/planer\//.test(fil) || /\/specar\//.test(fil)) return 1.2;
  if (/(^_logg\/|\/log\/|\/nattskift\/)/.test(fil)) return 0.6;
  return 1;
}

const MAX_PER_FIL = 2;

// Nyckelord: OR-fråga över orden så att en enda träff på ett namn räcker.
function tsFraga(fraga: string, enkel = false): string | null {
  const ord = fraga
    .toLowerCase()
    .normalize("NFC")
    .match(/[\p{L}\p{N}]{3,}/gu);
  const kvar = enkel ? ord : ord?.filter((o) => !STOPPORD.has(o));
  return kvar?.length ? [...new Set(kvar)].map((o) => `${o}:*`).join(" | ") : null;
}

/**
 * Hybrid sökning: vektorsökning i pgvector och fulltext i Postgres,
 * sammanvägda med Reciprocal Rank Fusion. Vektorer fångar betydelse,
 * fulltext fångar namn, koder och siffror som inbäddningar ofta missar.
 */
export type Lage = "hybrid" | "vektor" | "nyckelord";

export async function sok(
  fraga: string,
  { n = 6, bolag, lage = "hybrid", enkel = false }: { n?: number; bolag?: string; lage?: Lage; enkel?: boolean } = {},
): Promise<Traff[]> {
  const djup = Math.max(20, n * 4);
  const filter = bolag ? { bolag } : undefined;

  const [vektor, nyckel] = await Promise.all([
    lage === "nyckelord"
      ? Promise.resolve([] as { id: string }[])
      : badda_in_fraga(fraga).then((q) =>
          vektorer.query({ indexName: konfig.index, queryVector: q, topK: djup, filter }),
        ),
    (async () => {
      if (lage === "vektor") return [] as { id: string }[];
      const q = tsFraga(fraga, enkel);
      if (!q) return [] as { id: string }[];
      const r = await db.query(
        `SELECT id FROM minne_delar, to_tsquery('simple', $1) q
         WHERE tsv @@ q ${bolag ? "AND bolag = $3" : ""}
         ORDER BY ts_rank_cd(tsv, q) DESC LIMIT $2`,
        bolag ? [q, djup, bolag] : [q, djup],
      );
      return r.rows as { id: string }[];
    })(),
  ]);

  const poang = new Map<string, { p: number; via: string[] }>();
  const lagg = (id: string, rang: number, kalla: string) => {
    const e = poang.get(id) ?? { p: 0, via: [] };
    e.p += 1 / (RRF_K + rang + 1);
    e.via.push(kalla);
    poang.set(id, e);
  };
  vektor.forEach((r, i) => lagg(r.id, i, "vektor"));
  nyckel.forEach((r, i) => lagg(r.id, i, "nyckelord"));
  if (!poang.size) return [];

  const rader = (
    await db.query("SELECT id, fil, bolag, rubrik, text FROM minne_delar WHERE id = ANY($1)", [[...poang.keys()]])
  ).rows as Omit<Traff, "poang" | "via">[];
  const viktade = rader
    .map((r) => {
      const e = poang.get(r.id)!;
      return { ...r, rubrik: (r.rubrik ?? "").slice(0, 140), poang: Number((e.p * (enkel ? 1 : kallvikt(r.fil))).toFixed(4)), via: e.via };
    })
    .sort((a, b) => b.poang - a.poang);

  // Högst MAX_PER_FIL delar per fil, så att en lång fil inte tar alla platser.
  const perFil = new Map<string, number>();
  const ut: Traff[] = [];
  for (const t of viktade) {
    const c = perFil.get(t.fil) ?? 0;
    if (!enkel && c >= MAX_PER_FIL) continue;
    perFil.set(t.fil, c + 1);
    ut.push(t);
    if (ut.length >= n) break;
  }
  return ut;
}
