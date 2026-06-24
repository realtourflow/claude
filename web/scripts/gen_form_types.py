#!/usr/bin/env python3
"""Generate lib/form-ai/form-types.json (the document-type catalog the seed loads)
from the human-edited master list lib/form-ai/master-field-list.csv.

The CSV is the source of truth Paul maintains (cols: document_type,label,type,role,
tier,core_key,required,source,note). This script groups it by document_type, attaches
per-type metadata (label/description/side — defined below, NOT in the CSV), validates
every field, and writes the JSON artifact. Re-run after editing the CSV:

    python3 scripts/gen_form_types.py
"""
import csv
import json
import os
import sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "..", "lib", "form-ai", "master-field-list.csv")
OUT = os.path.join(HERE, "..", "lib", "form-ai", "form-types.json")

# Per-type metadata — the CSV is field-level only. (key -> label, description, side).
# side in {buy, sell, both}. Order here = order in the catalog.
META = OrderedDict([
    ("purchase_agreement", ("Purchase Agreement",
        "The fields any residential purchase agreement needs, mapped to auto-fill core keys where they apply. Position-FREE: a specific layout supplies coordinates via recognition (known_forms) or guided vision per upload.",
        "both")),
    ("wire_fraud", ("Wire Fraud Advisory",
        "Wire-fraud advisory/notice acknowledged and signed by the consumer(s).", "both")),
    ("brokerage_services_disclosure", ("Real Estate Brokerage Services Disclosure",
        "AREC Real Estate Brokerage Services Disclosure — licensee + consumer acknowledgement of the agency relationship.", "both")),
    ("documentation_fee", ("Documentation Fee Agreement",
        "Brokerage documentation / transaction-fee agreement signed by the client(s).", "both")),
    ("inspection_addendum", ("Inspection Addendum",
        "Inspection-contingency addendum to a residential purchase agreement.", "buy")),
    ("lead_based_paint", ("Lead-Based Paint Disclosure",
        "Federal lead-based paint disclosure & acknowledgement for pre-1978 housing (seller discloses, buyer acknowledges).", "both")),
    ("buyer_agency", ("Buyer Agency Agreement",
        "Exclusive buyer agency / representation agreement between the buyer(s) and the brokerage.", "buy")),
    ("addendum_contingent_sale", ("Contingency for Sale of Buyer's Property Addendum",
        "Addendum making the purchase contingent on the sale of the buyer's existing property.", "buy")),
    ("listing_agreement", ("Listing Agreement",
        "Exclusive right-to-sell residential listing agreement between the seller(s) and the listing brokerage.", "sell")),
    ("addendum", ("Addendum",
        "Generic addendum / amendment to an underlying real estate agreement.", "both")),
])

REGISTRY = {
    "buyer_name", "agent_name", "brokerage_name", "legal_description", "parcel_or_ppin",
    "city", "state", "zip", "purchase_price", "earnest_money_amount", "earnest_money_holder",
    "financing_type", "loan_amount_or_pct", "offer_date", "acceptance_binding_date",
    "closing_date", "possession", "buyer_broker_comp", "agency_role", "included_fixtures",
    "additional_provisions",
}
FIELD_TYPES = {"text", "checkbox", "signature", "initial", "date"}
TIERS = {"core", "common"}


def main() -> int:
    with open(CSV, newline="") as fh:
        rows = list(csv.DictReader(fh))

    by_type = OrderedDict()
    errors = []
    for i, r in enumerate(rows, start=2):
        dt = r["document_type"].strip()
        label = r["label"].strip()
        ftype = r["type"].strip()
        tier = r["tier"].strip()
        req = r["required"].strip().upper()
        ck = r["core_key"].strip()
        if dt not in META:
            errors.append(f"row {i}: unknown document_type {dt!r}")
            continue
        if ftype not in FIELD_TYPES:
            errors.append(f"row {i} {dt}/{label}: bad type {ftype!r}")
        if tier not in TIERS:
            errors.append(f"row {i} {dt}/{label}: bad tier {tier!r}")
        if req not in ("TRUE", "FALSE"):
            errors.append(f"row {i} {dt}/{label}: bad required {req!r}")
        if ck and ck not in REGISTRY:
            errors.append(f"row {i} {dt}/{label}: unknown core_key {ck!r}")
        by_type.setdefault(dt, []).append({
            "label": label,
            "type": ftype,
            "role": r["role"].strip(),
            "tier": tier,
            "core_key": ck or None,
            "required": req == "TRUE",
            "source": r["source"].strip(),
            "note": r["note"].strip(),
        })

    # dup labels within a type
    for dt, fields in by_type.items():
        seen = {}
        for f in fields:
            seen[f["label"]] = seen.get(f["label"], 0) + 1
        for lab, c in seen.items():
            if c > 1:
                errors.append(f"{dt}: duplicate label {lab!r} ({c}x)")

    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print("  " + e, file=sys.stderr)
        return 1

    catalog = []
    for key, (label, desc, side) in META.items():
        fields = by_type.get(key, [])
        catalog.append({
            "key": key,
            "label": label,
            "description": desc,
            "side": side,
            "field_count": len(fields),
            "fields": fields,
        })

    with open(OUT, "w") as fh:
        json.dump(catalog, fh, indent=2)
        fh.write("\n")

    print(f"wrote {OUT}")
    for t in catalog:
        print(f"  {t['key']}: {t['field_count']} fields  (side={t['side']})")
    print(f"  TOTAL: {sum(t['field_count'] for t in catalog)} fields across {len(catalog)} types")
    return 0


if __name__ == "__main__":
    sys.exit(main())
