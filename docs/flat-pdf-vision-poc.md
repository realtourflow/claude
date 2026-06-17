# Flat-PDF Vision Detection — POC Measurement

*June 2026 · de-risking exercise, not a build · ran on 4 real agent forms*

This is a measurement of the hardest unsolved part of the flat-PDF path: detecting
the exact **position** of each fillable spot on a flat PDF (not just its meaning).
It does **not** build or wire the feature. Output: per-form accuracy, failure
modes, and a recommendation.

## What was tested

Four real flat forms Paul uploaded, plus the BAA blank for reference:

| Form | Pages | AcroForm fields | Verdict |
|---|---|---|---|
| Wire Fraud Prevention Notice | 1 | 0 | truly flat |
| Lead-Based Paint Disclosure (Huntsville AAR) | 2 | 0 | truly flat |
| Real Estate Brokerage Services Disclosure (AL REC) | 2 | 1 (stray dotloop sig) | effectively flat |
| Inspection Addendum (ValleyMLS) | 1 | 0 | truly flat |
| Buyer Agency Agreement (blank) — reference | 3 | **36** (text + checkbox) | **fillable** |

> Two findings before any accuracy numbers:
> - **The BAA blank is fillable (36 AcroForm fields).** "Validate step 5 against the BAA" therefore exercises the **AcroForm** path (exact), not vision. Good for validating step 5's placement math; it does **not** validate vision.
> - **The brokerage copy on hand is already dotloop-signed, not blank.** Agents will upload *completed* forms from past deals. The pipeline must detect and reject/flag a filled upload — a real product gap, not covered today.

## Method (and its honest limit)

The "vision pass" was run by having Claude view each rendered page and produce,
per fillable spot: the **type** (text/checkbox/signature/initial/date), the
**meaning** (mapped to our 21 core keys, or "none"), and a **position estimate**.
This is the same model a production `VisionFieldDetector` would call.

> ⚠️ **Limit:** there is no machine-readable ground-truth coordinate set to diff
> against. Accuracy below is the detector's own confidence graded against the
> visible target, in three bands — **NAILED** (a drawn box / crisp target a tab
> would land in), **CLOSE** (locatable, but tab width/vertical offset is a
> judgment call), **OFF/MISSED** (likely misplaced or not found). Treat these as
> directional, not as a measured error in points. A real accuracy number needs
> labeled coordinates — which is itself an argument for the recognition library
> (verify once, store exact positions, stop guessing).

## The core finding: difficulty tracks field *style*, not form complexity

Position reliability depends almost entirely on how the blank is drawn:

| Field style | Example | Position reliability |
|---|---|---|
| **Drawn box** (a real rectangle) | signature/name boxes on Wire Fraud; checkboxes + cert + initial boxes on Lead Paint; the right-column Purchaser/Seller boxes on Inspection | **NAILED** — the box edges tell you exactly where the tab goes |
| **Underline after a label** | `Date: ___`, `Name of Licensee ___` | **CLOSE** — locatable, but does the tab sit on the line or above it, and how wide? |
| **Several blanks on one line, labels below** | `City / County / State / Zip` on Inspection | **CLOSE** — needs segmenting; one label (County) has no core key |
| **Mid-sentence inline blank** | `within ___ working days`, `Dated this ___ day of ___` | **OFF / MISSED** — small, embedded in justified text; the highest silent-error risk |
| **Overlapping label + line** | the WITNESS/DATE grid on Inspection | **CLOSE→OFF** — which underline segment is the signature vs the date? |

The legally-critical fields here (signatures, initials) are frequently **drawn
boxes**, which is the good case. The dangerous case is the small inline blank.

## Per-form readout

**Wire Fraud (7 fields) — EASIEST.** 1 brokerage-name line, 2 print-name boxes, 2
signature boxes, 2 date lines. Meaning maps cleanly (it's literally the
`al_wire_fraud_notice` already in v1). Names/signatures are drawn boxes → NAILED;
dates and the brokerage line are underlines → CLOSE. Recall 7/7. **~70% NAILED,
30% CLOSE, 0 missed.** No membership restriction on this copy.

**Brokerage Services Disclosure (6 fields on a blank) — EASY, but wrong artifact.**
Page 1 is pure info text; all fields are on page 2 (Name of Licensee, Licensee
Signature box, Date, Name of Consumer, Consumer Signature box, Date). Meaning
clean (agent_name, consumer_name, signatures, dates). Signature boxes NAILED,
name/date underlines CLOSE. **But the file on hand is already signed** — a
real blank is needed to measure properly. State-mandated AL REC form → likely no
distribution restriction.

**Lead-Based Paint (≈40 fields, 2 pages) — MEDIUM, dragged down by volume + meaning.**
~16 election checkboxes (NAILED — crisp squares), ~20 initial boxes (NAILED
position), 6 certification signature boxes (NAILED), 6 date lines (CLOSE), 2
property lines + 3 explain lines (CLOSE). Position is mostly strong. The problems
are: (1) **recall** — ~40 fields means a couple will be dropped; a missed initial
box = a required initial with nowhere to go; (2) **meaning** — the paired initial
boxes are party-ambiguous (buyer vs seller initials), checkboxes are form-specific
elections (not core keys), and `property at ___` has no single core key (we have
city/state/zip/legal, not a unified address). **~75% NAILED/CLOSE on position,
but meaning is messy and recall is the risk.** Member-restricted (Huntsville AAR).

**Inspection Addendum (≈30 fields, 1 page) — HARDEST.** A dense two-column
signature grid (6 WITNESS underlines + 6 dates on the left; 6 Purchaser/Seller
boxes + 6 dates on the right) with **labels overlapping the lines**, plus
top-of-form Purchaser/Seller/property lines, a 4-in-a-row `City County State Zip`
line, and two **mid-sentence inline blanks** (`within __ working days`, `Dated
this __ day of __`). Right-column boxes NAILED; witness underlines + overlapping
dates CLOSE→OFF; inline blanks OFF/likely-missed; County has no core key.
**~50% NAILED, ~30% CLOSE, ~20% OFF/missed.** Member-restricted (ValleyMLS — the
exact "USE BY ANYONE OTHER THAN A MEMBER … STRICTLY PROHIBITED" string the design
note calls out).

**Difficulty ranking:** Wire Fraud < Brokerage(blank) < Lead Paint < Inspection.

## Failure modes (brutally honest)

1. **Mid-sentence inline blanks** — the worst. Small, embedded in justified
   paragraphs; easy to miss entirely or place a tab in the wrong spot. On a legal
   contract, a missed `within __ days` is a real defect.
2. **Recall on dense forms** — 30–40-field forms will drop a few fields; a dropped
   signature/initial is the dangerous miss.
3. **Coordinate conversion (systemic, separate from detection)** — vision returns
   image-relative boxes; converting to PDF points for step 5 needs the exact
   render scale/DPI. A wrong scale shifts **every** tab uniformly. Must render at
   a known DPI and convert precisely; this is a single point of total failure if
   gotten wrong.
4. **Underline vertical offset** — placing a tab on the text baseline vs just
   above the line. A few points is cosmetic on a sparse form but **collides with
   the next row** on a tight grid (Inspection).
5. **Filled-vs-blank uploads** — the brokerage sample was already signed. A vision
   pass on a filled form detects the *filled* values as spots. Needs explicit
   "is this blank?" detection.
6. **Party / role disambiguation** — initials and signatures assigned to the wrong
   party (buyer vs seller vs witness). Step 5's derive-then-confirm Signers panel
   catches this *if* a human checks; the per-field guess alone is unreliable.
7. **Core-key gaps** — `property address` (single line) and `county` have no core
   key, so they land unmapped → human review. Not silent; acceptable, but worth a
   registry decision.

## Hardest vs easiest form types

- **Hardest:** dense signature/initial grids with overlapping labels (Inspection),
  forms with mid-sentence inline blanks (Inspection), long multi-clause
  initial-per-item disclosures (Lead Paint — recall + party ambiguity).
- **Easiest:** few-field forms built from drawn boxes (Wire Fraud) — and notably,
  it's already a known v1 form.

## Recommendation

**Needs the recognition library alongside it.** Not "solid enough to ship as-is",
not "different tactic."

- **Why not as-is:** on legally-binding documents, the combination of inline-blank
  misses, recall gaps on dense forms, coordinate-conversion fragility, and
  party-assignment guesses means unsupervised vision will eventually drop a
  signature line or land a tab on printed text. That's not acceptable unattended.
- **Why not a different tactic:** vision genuinely *works* for meaning and for
  drawn-box positions, and the **human review gate already built in step 4**
  catches the rest — every vision-detected field becomes a reviewable row,
  low-confidence ones flagged, nothing auto-approved.
- **The architecture that wins is exactly the design note's three layers:**
  1. **Recognition library** — verify a form once, store its exact field map +
     positions, and every future upload of it gets exact placement with **zero
     vision**. These four forms are the high-frequency ones — they should be the
     library's seed. That converts the risky path into the exact path for the
     common case.
  2. **AcroForm extraction** — exact, for fillable uploads (e.g. the BAA).
  3. **Vision** — best-effort, **always feeding the human gate**, for the genuinely
     new long tail only.

So: **build vision, but behind the review gate, and build the recognition library
with it (arguably first).** Vision's real job is the long tail; the library +
gate carry the everyday load and keep a misplaced tab off a contract.

### Concrete next steps (when greenlit — not now)

1. Recognition library: fingerprint (text-layout signature is likely enough; visual
   hash as backup) + stored field map; seed with these 4 forms once verified.
2. Wire `VisionFieldDetector` (this POC's interface) as the fallback into the
   existing `runFieldPipeline`, replacing only the position-finding for flat PDFs.
   Nail the image→PDF-point conversion with a fixed render DPI; unit-test it like
   step 5's coordinate math.
3. Add a "blank-form" check to reject filled uploads.
4. Keep the licensing gate (§6 of the design note) ahead of any sharing — the
   ValleyMLS / Huntsville-AAR restrictions on two of these four are real.

---

*Behind the same swappable interface as the mapper: `web/lib/form-ai/vision.ts`
(`VisionFieldDetector` + `setVisionDetectorForTesting`) — interface + fake only,
not wired. The fillable-PDF path (extract.ts) is unchanged and stays.*
