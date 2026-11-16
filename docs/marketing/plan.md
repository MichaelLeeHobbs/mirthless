# GalvaniGraph marketing plan

Status: draft for Michael's decisions (bottom of this page). Date: 2026-11-15.

## The pitch in one line

GG, Mirth. The open-source healthcare integration engine that runs in a browser, scripts in TypeScript and costs nothing, for teams who watched Mirth close its source and Rhapsody send the invoice.

## Who we're talking to

- **The integration analyst or engineer.** Lives in Mirth's Java Administrator every day, gets paged at 2am, writes the transformers. This person tries us first and champions us. Doc 18 shows what they hate: the desktop client and its launcher (rank 1 of 160 themes, 239 sources) and the paywall and 4.6 license change (rank 3).
- **The person who signs the check.** An IT director or CIO who just got a Mirth renewal quote or a Rhapsody quote. They care about price, risk and who answers at 2am.
- **Developers new to healthcare.** They know TypeScript and npm and have never seen an MLLP frame. Mirth asks them to learn Rhino and E4X first. We don't.

## Voice

GalvaniGraph is the cocky new kid who can back it up. Short sentences, gamer slang where it lands, numbers instead of adjectives.

Rules for the attitude:

1. **Punch at software and pricing, never at people.** The analyst with fifteen years of Mirth is our best future user. Mocking them as "boomers" insults the person we need to win, and an ageist line in a public README is the screenshot that goes around for the wrong reason. Make fun of the Java launcher, the paywall and the $50,000 quote. Respect the people who kept those systems running.
2. **Leave the forks alone.** Open Integration Engine and BridgeLink are volunteers keeping Mirth's open code alive. They are allies against closed source and their users are our users. We're the rewrite; they're the continuation. Never punch down at them.
3. **Every jab has a receipt.** A claim about a competitor carries a dated link. A claim about us matches a row in [capabilities.md](../user/capabilities.md). See the claim rules below.
4. **Brag about the gaps.** Publishing what we lack is the move no vendor makes. It's also the answer to the trust barrier doc 18 found ("who answers at 2am, has anyone tested this"). The README's "What we don't have yet" section is part of the brand, not a disclaimer.

## The name

**GalvaniGraph**, written with both G's in the accent colour so the eye reads **GG**. Luigi Galvani found the electrical signal in living tissue; a "graph" is the trace of that signal. The wordmark draws a pulse line under the name for that reason.

A web search on 2026-11-15 found no product or project called GalvaniGraph. Before committing: run a USPTO and EUIPO trademark search in classes 9 and 42, and register the GitHub org, npm scope `@galvanigraph`, and the .com/.io domains on the same day the name is decided.

Two risks to weigh:

- **It's the second rename in three weeks.** D-205 renamed Mirthless to GalvaniFlow on 2026-10-27. No version is tagged yet, so this is still the cheap moment, the same argument D-205 made. After v0.1.0 a rename costs users. So: rename now, or keep GalvaniFlow for good.
- **"Graph" has another meaning in software.** Developers may expect a graph database or a charting library. The tagline line under the wordmark ("Healthcare integration engine") and the README's first sentence carry that; watch the first Hacker News or Reddit thread for confusion.

## Messages

| Line | Use |
|---|---|
| GG, Mirth. It was a good game. | Headline, social cards, conference sticker |
| Game over. Mirth closed its source in 2025. | The hook for Mirth users looking for a way out |
| $50,000 a year for five connections. Or $0. | Rhapsody comparison, always with the footnote |
| Your sixth connection is a call to sales. | Rhapsody comparison, second beat |
| Your interface engine shouldn't need a Java launcher. | Analyst audience, matches doc 18 rank 1 |
| Here's what we don't have yet. | Trust; links to capabilities.md |
| TypeScript end to end. | Developer audience |

Cut lines that can't carry a source. The current README's "13ms message processing, Mirth does ~70ms" is one: 13 ms is one transformer message on a dev machine (D-112), our own benchmark measures 30 to 55 ms median with a sandbox script ([throughput-benchmark.md](../ops/throughput-benchmark.md)), and nothing in the repository measures Mirth. The draft README drops it. Performance comes back as a headline only after a side-by-side benchmark we publish with its method.

## Claim rules

- A capability claim names something with a **Yes** row in capabilities.md. Partial is said as partial.
- A competitor claim links a public page and the date it was checked. Competitor prices are list prices from public listings, said as "lists at".
- Facts checked on 2026-11-15:
  - Mirth Connect 4.6 (March 2025) is closed source under a commercial license; 4.5.2 was the last open release. Source: NextGen's downloads page and announcement.
  - Rhapsody as a Service lists at $50,000 per 12 months for one production license and up to five communication points. Corepoint as a Service, from the same seller, lists at $60,000 for the same. Further licensing is by private offer. Source: AWS Marketplace listings linked in the README footnotes. The "$60K a year" figure is Corepoint's, not Rhapsody's, so the copy names both.
- Mirth, Mirth Connect, Rhapsody and Corepoint are other companies' trademarks. Naming them in truthful comparisons is normal practice; using their logos, or implying an endorsement, is not. The README carries a trademark line. If the "GG Mirth" campaign goes beyond the README into paid ads or merchandise, have a lawyer read it first.

## Plan

### Step 1: decide the name (Michael, this week)

Rename or keep, trademark search, grab the handles. Nothing else starts until this is settled.

### Step 2: the rename PR

One PR, one concern, following D-205's pattern. About 900 files mention `galvaniflow`, most in `packages/server`, `packages/web` and `packages/connectors`.

- Display name `GalvaniGraph`, identifiers `galvanigraph`, package scope `@galvanigraph`, metrics `galvanigraph_*`, wire defaults `GALVANIGRAPH` (12 characters, inside DICOM's 16-character AE title limit).
- Keep both old marker names readable, as D-205 did: `.mirthless-quarantine.json` and `.galvaniflow-quarantine.json` both merge into the new ledger, and `$MirthlessDispatched` and the GalvaniFlow marker still count as dispatched. A blind rename re-delivers files and emails already handled.
- Existing databases keep their names; only defaults change.
- Move `docs/marketing/README-draft.md` to `/README.md` and drop the leading `../` from its links; move the wordmarks to a root `assets/` folder or update their paths.
- Put the two-colour G in the app: the sign-in page and the top bar, with colours from `tokens.ts`.
- A new decision in DECISIONS.md that supersedes D-205's name.
- Rename the GitHub repository from `mirthless` last; GitHub redirects the old URLs.

### Step 3: launch gates

Don't send traffic to a front door that sticks. Before any public push:

- The Docker production stack builds and starts from a clean checkout ([#137](https://github.com/MichaelLeeHobbs/mirthless/issues/137) is open), and a CI job proves it. Most evaluators will try Docker first.
- Tag v0.1.0 with release notes.
- A 90-second screen recording: import a Mirth channel, fix its script in the TypeScript editor, send an HL7 message, watch the dashboard. Time it for real before saying "90 seconds" anywhere.
- A public demo would be the strongest proof, but message content is PHI and a demo invites real data. If we run one, it resets nightly, says "synthetic data only" on the sign-in page, and the seeded channels generate the traffic.
- SECURITY.md and the "What we don't have yet" list are current on launch day.

### Step 4: launch

- **GitHub**: the new README, a social preview image (the wordmark on the dark surface, 1280×640), topics `hl7`, `fhir`, `mirth`, `interface-engine`, `healthcare`, `typescript`.
- **Show HN**: "Show HN: GalvaniGraph, an open-source Mirth Connect alternative in TypeScript". Lead with the 4.6 license change and the capabilities page; Hacker News rewards the honest gap list.
- **Reddit**: r/healthIT and r/HL7, as a person who builds interfaces, not as an ad. Read each subreddit's self-promotion rule first.
- **Mirth and OIE communities**: answer "what now after 4.6" threads with the migration guide, not the GG line. In their house we're helpful, not cocky.
- **LinkedIn**: Michael's account, the GG card and the price line, aimed at the people who sign checks.

### Step 5: keep it going

- A migration guide, "Leaving Mirth": export, import preview, the script rewrites the preview names, cut-over. This is the page that turns interest into installs.
- One short post per shipped feature that Mirth charges for, each with the GG card.
- A published, reproducible benchmark against Mirth 4.5.2 on the same hardware. Only then use a speed headline.

## Measuring it

GalvaniGraph has no phone-home and won't get one (D-260), so we measure only what's public: GitHub stars and forks, Docker image pulls, issues and discussions opened by people other than Michael, and traffic to the migration guide. Check them one week and four weeks after launch.

## Decisions for Michael

1. **Rename to GalvaniGraph, or keep GalvaniFlow?** My pick: rename now, before v0.1.0, if the trademark search is clean. After the tag it gets expensive.
2. **The "boomer" angle: drop it, or keep it?** My pick: drop it from anything public and aim the attitude at the software and the prices. The README draft does that.
3. **Launch before or after #137 is fixed?** My pick: after. A broken `docker compose up` is the first impression we can't take back.
4. **Public demo instance: yes or no?** My pick: not at launch. The recording does the job without the PHI risk.
