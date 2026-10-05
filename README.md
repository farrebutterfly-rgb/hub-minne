# hub-minne

Lokalt RAG-minne för en agentplattform. Gör en mapp med markdown (regler, beslut,
status och planer för flera bolag) sökbar och frågbar, med svar som pekar på källorna.
Allt körs på en Mac mini. Ingen text lämnar maskinen.

Byggt för Holger Hub, en egen plattform där AI-agenter (Claude Code, Codex,
OpenClaw, Hermes) körs, följs upp och får godkännanden. Det här är minnesdelen,
bruten ut som ett fristående projekt.

## Stack

- **TypeScript på Node**, **Express** för API:t
- **Mastra**: `Agent`, `MDocument` för uppdelning och `PgVector`
- **PostgreSQL 17 med pgvector** för vektorer och Postgres fulltext för nyckelord
- **Lokala modeller via LM Studio** (OpenAI-kompatibelt API): nomic-embed-text v1.5
  för inbäddningar och Qwen 3.5 9B för svar

## Så fungerar det

```
markdown ──► uppdelning efter rubriker ──► inbäddning (nomic, lokal) ──► pgvector
                    │                                                   │
                    └──────────────► Postgres fulltext (tsvector) ◄─────┘
                                                │
fråga ──► vektorsökning + fulltext ──► Reciprocal Rank Fusion ──► källvikt ──► Mastra-agent (Qwen) ──► svar med [1] [2]
```

- **Uppdelning:** efter rubriker, högst 1 400 tecken. Varje del får fil och rubrik
  först, och filens frontmatter blir en egen del.
- **Inkrementell indexering:** varje fil har en hash. Bara ändrade filer bäddas in
  igen, och borttagna filer tas bort. Hela korpusen (576 filer, cirka 4 800 delar)
  tar under fyra minuter första gången.
- **Hybrid sökning:** vektorer fångar betydelse, fulltext fångar namn, koder och
  belopp. De vägs ihop med Reciprocal Rank Fusion (k = 60).
- **Källvikt:** dokument som är sanningen om ett bolag (context, status, regler)
  väger tyngre än loggar och agentrapporter, som upprepar samma fakta i andra hand.
  Högst två delar per fil kommer med bland träffarna.
- **Agent:** en Mastra-agent som bara svarar ur källorna, hänvisar med [n] och har
  ett sökverktyg för egna följdsökningar.

## Utvärdering

`npm run eval` kör ett frågeset med kända svar och jämför fyra söksätt.
**fakta@5** är andelen frågor där svaret finns i de fem hämtade delarna.
**källa@5** är andelen där den kanoniska källfilen kommer med.

Resultat på 22 frågor (k = 5), oktober 2026:

| Söksätt | fakta@5 | källa@5 | MRR |
|---|---|---|---|
| Nyckelord (Postgres fulltext) | 41 % | 9 % | 0,30 |
| Vektor (pgvector) | 45 % | 9 % | 0,29 |
| Hybrid (RRF) | 59 % | 5 % | 0,41 |
| Hybrid med källvikt och spridning | **77 %** | **45 %** | **0,54** |

Två saker gav mest. Källvikten löste att samma fakta upprepades i loggar och
agentrapporter som trängde undan originalet. Utvärderingen hittade också en bugg:
fakta i filernas frontmatter kom inte med alls, och när de togs med som en egen
del gick träffsäkerheten från 73 till 77 procent.

Frågesetet med riktiga data ligger lokalt och checkas inte in. `eval/fragor.exempel.json`
visar formatet.

## Köra

```bash
cp .env.example .env          # sökväg, Postgres och modeller
npm install
npm run indexera              # bygger eller uppdaterar indexet
npm start                     # API på 127.0.0.1:4300
npm run fraga -- "vilka regler gäller för klientdata?"
npm run eval
```

API: `GET /sok?q=`, `POST /fraga {"fraga": "..."}`, `GET /halsa`. Tjänsten lyssnar bara
på localhost och läser aldrig källmappen själv. Indexeringen körs som ett eget
schemalagt jobb (`npm run indexera`), så att tjänsten kan köras med minimala rättigheter.

## Licens

MIT
