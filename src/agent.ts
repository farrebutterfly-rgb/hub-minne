import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { konfig } from "./konfig.js";
import { sok, type Traff } from "./sok.js";

// Verktyget som agenten själv kan anropa när första sökningen inte räcker.
export const sokMinnet = createTool({
  id: "sok-minnet",
  description: "Söker i kunskapsbasen (regler, beslut, status och planer). Använd när du behöver mer underlag.",
  inputSchema: z.object({
    fraga: z.string().describe("Vad du letar efter, gärna med namn och nyckelord"),
    bolag: z.string().optional().describe("Begränsa till en toppmapp i kunskapsbasen"),
  }),
  execute: async ({ fraga, bolag }) => {
    const t = await sok(fraga, { n: 5, bolag });
    return { traffar: t.map((x) => ({ fil: x.fil, rubrik: x.rubrik, text: x.text.slice(0, 1200) })) };
  },
});

export const minnesagent = new Agent({
  id: "minnesagent",
  name: "Minnet",
  instructions: `Du svarar på frågor utifrån kunskapsbasen.
- Svara på svenska, kort och konkret.
- Använd bara det som står i källorna. Om svaret inte finns där, säg det rakt ut.
- Hänvisa till källor med [1], [2] och så vidare efter påståendet.
- Hitta aldrig på siffror, datum eller namn.`,
  model: { providerId: "lokal", modelId: konfig.chattModell, url: konfig.llmUrl, apiKey: "lokal" },
  tools: { sokMinnet },
});

function kontext(traffar: Traff[]): string {
  return traffar
    .map((t, i) => `[${i + 1}] ${t.fil}${t.rubrik ? ` (${t.rubrik})` : ""}\n${t.text.slice(0, 1500)}`)
    .join("\n\n---\n\n");
}

// Tar bort eventuella tankeblock från resonerande modeller.
const rensa = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export async function fraga(fraga: string, { bolag }: { bolag?: string } = {}) {
  const start = Date.now();
  const traffar = await sok(fraga, { n: 6, bolag });
  if (!traffar.length) {
    return { svar: "Jag hittar inget om det i vaulten.", kallor: [], ms: Date.now() - start };
  }
  const res = await minnesagent.generate(
    [
      { role: "user", content: `Källor:\n\n${kontext(traffar)}\n\nFråga: ${fraga}` },
    ],
    { maxSteps: 3 },
  );
  return {
    svar: rensa(res.text),
    kallor: traffar.map((t, i) => ({ nr: i + 1, fil: t.fil, rubrik: t.rubrik, via: t.via })),
    ms: Date.now() - start,
  };
}
