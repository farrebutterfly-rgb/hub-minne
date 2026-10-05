import express from "express";
import { konfig } from "./konfig.js";
import { forbered } from "./lagring.js";
import { sok } from "./sok.js";
import { fraga } from "./agent.js";

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/halsa", (_req, res) => res.json({ ok: true, modell: konfig.chattModell, embed: konfig.embedModell }));

app.get("/sok", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 300);
  if (!q) return res.status(400).json({ fel: "q saknas" });
  try {
    res.json(await sok(q, { n: Number(req.query.n ?? 8), bolag: req.query.bolag ? String(req.query.bolag) : undefined }));
  } catch (e) {
    res.status(500).json({ fel: String(e) });
  }
});

app.post("/fraga", async (req, res) => {
  const f = String(req.body?.fraga ?? "").slice(0, 500);
  if (!f) return res.status(400).json({ fel: "fraga saknas" });
  try {
    res.json(await fraga(f, { bolag: req.body?.bolag }));
  } catch (e) {
    res.status(500).json({ fel: String(e) });
  }
});

await forbered();
// Bara localhost: Hub anropar härifrån, inget exponeras utåt.
app.listen(konfig.port, "127.0.0.1", () => console.log(`minne lyssnar på 127.0.0.1:${konfig.port}`));
