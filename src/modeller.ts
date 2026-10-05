import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed, embedMany } from "ai";
import { konfig } from "./konfig.js";

// Allt går till en lokal OpenAI-kompatibel server. Ingen text lämnar maskinen.
const lokal = createOpenAICompatible({ name: "lokal", baseURL: konfig.llmUrl, apiKey: "lokal" });
export const embedModell = lokal.embeddingModel(konfig.embedModell);

// nomic-embed-text är tränad med prefix som skiljer dokument från frågor.
const arNomic = /nomic/i.test(konfig.embedModell);
const dokPrefix = arNomic ? "search_document: " : "";
const fragaPrefix = arNomic ? "search_query: " : "";

export async function badda_in_dokument(texter: string[]): Promise<number[][]> {
  const ut: number[][] = [];
  for (let i = 0; i < texter.length; i += 32) {
    const { embeddings } = await embedMany({
      model: embedModell,
      values: texter.slice(i, i + 32).map((t) => dokPrefix + t),
      maxParallelCalls: 2,
    });
    ut.push(...embeddings);
  }
  return ut;
}

export async function badda_in_fraga(fraga: string): Promise<number[]> {
  const { embedding } = await embed({ model: embedModell, value: fragaPrefix + fraga });
  return embedding;
}
