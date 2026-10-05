import pg from "pg";
import { PgVector } from "@mastra/pg";
import { konfig } from "./konfig.js";

// Vektorerna hanteras av Mastra i pgvector. Bredvid ligger två egna tabeller:
// minne_filer håller koll på vad som är indexerat (för inkrementell uppdatering)
// och minne_delar har texten med ett tsvector-index för nyckelordssökning.
export const vektorer = new PgVector({ id: "minne", connectionString: konfig.pg });
export const db = new pg.Pool({ connectionString: konfig.pg, max: 4 });

export async function forbered(): Promise<void> {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS minne_filer (
      fil text PRIMARY KEY,
      hash text NOT NULL,
      delar int NOT NULL,
      uppdaterad timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS minne_delar (
      id text PRIMARY KEY,
      fil text NOT NULL,
      bolag text,
      rubrik text,
      text text NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rubrik,'') || ' ' || text)) STORED
    );
    CREATE INDEX IF NOT EXISTS ix_delar_tsv ON minne_delar USING gin(tsv);
    CREATE INDEX IF NOT EXISTS ix_delar_fil ON minne_delar(fil);
  `);
  const finns = await vektorer.listIndexes();
  if (!finns.includes(konfig.index)) {
    await vektorer.createIndex({ indexName: konfig.index, dimension: konfig.dimension, metric: "cosine" });
  }
}

export async function stang(): Promise<void> {
  await db.end();
  await vektorer.disconnect();
}
