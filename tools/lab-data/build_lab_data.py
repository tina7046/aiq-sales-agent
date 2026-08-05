#!/usr/bin/env python3
"""
Build the prospect-table labs' page data by joining the two source CSVs.

    python3 tools/lab-data/build_lab_data.py

Writes two files, one per lab page, from the same join. Gulp injects each
into the page with the matching filename (see `getData` in gulpfile.js):

    prospect_table_lab.json  — FLAT: one row per prospect, 44 rows. The
                               account's fields repeat down its people.
    prospect_pivot_lab.json  — PIVOT: one row per account, 15 rows, with
                               its people spread across numbered
                               Prospect columns.

Two shapes of the same data, so the two can be compared side by side.
Re-run after editing either CSV.

Why a script rather than a hand-maintained JSON: the data has arrived in
two passes so far (accounts, then people), and joining 15 accounts to 36
prospects by hand is exactly the kind of thing that quietly goes wrong.

Sources, both in this directory:
    accounts_full.csv   — 15 target accounts, one row each, 13 columns.
                          Originally from Laulima-AgenticIQ-Slack/docs/.
                          Copied here so the lab regenerates without that
                          repo. The copy was for a while a 10-column
                          reduction missing Employees, Industry and
                          Location, which is why those three read n/a in
                          every lab; it now matches the source exactly.
    prospects_full.csv  — 36 people across 7 of those accounts, 7 columns.
                          Email and Phone arrived in a later pass; the
                          record ids, titles and accounts were unchanged
                          by it.

The logos came from the same place — Laulima-AgenticIQ-Slack/public/logos
— and live in src/assets/images/company-logos/accounts/. Adding an
account means dropping <slugified name>.png in there; this script refuses
to write anything if one is missing.

Grain: ONE ROW PER PROSPECT. Account-level fields (tier, rank, signals,
pitch…) repeat across that account's people, which is what a flat table
does. The 8 accounts with nobody listed are kept as single rows with the
person fields marked n/a — see KEEP_ACCOUNTS_WITHOUT_PROSPECTS.
"""

import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ACCOUNTS = os.path.join(HERE, "accounts_full.csv")
PROSPECTS = os.path.join(HERE, "prospects_full.csv")
OUT_FLAT = os.path.join(ROOT, "src", "views", "data", "prospect_table_lab.json")
OUT_PIVOT = os.path.join(ROOT, "src", "views", "data", "prospect_pivot_lab.json")

NA = "n/a"

# The 8 accounts nobody is listed against are mostly the "Avoid" tier,
# where having no prospects is the point. Kept as placeholder rows so the
# table still shows all 15 accounts and their tiers; flip to False to
# render only the 36 real people.
KEEP_ACCOUNTS_WITHOUT_PROSPECTS = True

# Real logos, one per account, 256px PNGs. Their own folder rather than
# company-logos/ itself, because the nine fictional marks in the parent
# (globex, initech, …) are what the LIVE conversation page renders, and
# two names would otherwise collide: rippling.png and acme.png.
#
# The filename is the account name slugified, so there's no map to keep
# in step — "salesforce.com" is salesforce-com.png and "Acme (Acme
# United)" is acme-acme-united.png. A missing file is a hard error
# below; a broken image frame in the table would be easy to miss.
LOGO_DIR_ABS = os.path.join(ROOT, "src", "assets", "images",
                            "company-logos", "accounts")
LOGO_DIR_URL = "/assets/images/company-logos/accounts"


def slugify(name):
    """"Acme (Acme United)" -> "acme-acme-united"."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def clean(value):
    """Collapse whitespace. Empty or missing becomes the n/a marker."""
    if value is None:
        return NA
    value = re.sub(r"\s+", " ", value).strip()
    return value or NA


def semis(value):
    """Semicolon-separated CSV field -> list, or [] when absent."""
    value = clean(value)
    return [] if value == NA else [p.strip() for p in value.split(";") if p.strip()]


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


# ── Opportunities, and the Recommended Pitch ──────────────────────────
# Two different things, and the difference is worth stating.
#
# `opportunities` is REAL DATA, only structured: the account CSV's CRM
# column is one prose string per account, and this splits it into the
# opportunities it names so a template can lay out the name, the amount
# and the stage separately instead of printing the sentence.
#
# `pitch` is SYNTHESIZED — derived from each person's job title, because
# the CSV carries a pitch per account and the table wants one per person.
# Deterministic, so the layout doesn't move on a rebuild, but placeholder
# copy: replace it when real per-person pitch text arrives.

# Longest first: "Solution Validation" has to be tested before a bare
# "Validation" would match, and a stage list in arbitrary order would let
# a substring win.
OPP_STAGES = ["Solution Validation", "Qualification", "Negotiation",
              "Discovery", "Renewal", "Expansion"]

# Title keyword -> pitch angle. ORDER IS LOAD-BEARING, because titles
# overlap: "Director, Revenue Enablement" contains "revenue" and would be
# read as RevOps, and "VP, GTM Finance & Ops" contains "ops". The
# narrowest, most specific readings go first.
#
# Note "growth marketing" rather than a bare "growth" — otherwise "Head of
# Sales, Startups & Growth" gets pitched a marketing angle.
PITCH_BY_TITLE = [
    (("enablement",),
     "Enablement that adapts per rep instead of six playbook versions "
     "nobody opens — the messaging is generated against each account."),
    (("finance",),
     "Cost per qualified meeting, not per seat: the same coverage without "
     "the headcount line or the tooling sprawl underneath it."),
    (("revops", "revenue operations", "stratops", "strategy & ops",
      "operations", " ops"),
     "Six-plus GTM tools collapse into one layer. No new stack to "
     "administer, and the routing logic stops living in three places."),
    (("sales dev", "sdr", "bdr", "new biz", "new business", "outbound"),
     "Ramp is the leak — new reps take ~90 days to produce. This has them "
     "sourcing qualified accounts inside week one."),
    (("demand gen", "marketing", "cmo"),
     "Stop handing sales unqualified lists: only accounts showing live "
     "intent get routed, with the signal attached to the handoff."),
    (("cro", "head of sales", "director of sales", "svp of sales", "sales",
      "gm,", "enterprise", "ceo", "gtm"),
     "Hit the number without adding headcount — the same pipeline "
     "coverage from the team you already have."),
]

DEFAULT_PITCH = ("Pipeline coverage without more headcount: the same "
                 "outbound motion, run as an AI-native layer.")


def parse_opps(account_crm):
    """Split the CRM column into the opportunities it names.

    "Active GTM Platform opp ($180K Discovery) + Renewal ($145K)"
        -> [{name: "GTM Platform",  amount: "$180K", stage: "Discovery"},
            {name: "Renewal",       amount: "$145K", stage: ""}]

    These strings are prose, and two things make them awkward:

    They carry clauses that are NOT opportunities — "Peer case study
    owed", "Jordan Reyes requested Q3 re-engagement", "NOT a cold
    prospecting target". Requiring a "$" inside the parentheses is what
    separates a deal from a note; nothing else in them is parenthesised
    with a figure.

    And "+" means two different things. In Notion's line it separates two
    opportunities; in Kestrel's "Enterprise Renewal + Expansion ($260K…)"
    it's part of one opportunity's name. So this doesn't split on "+" at
    all — it matches NAME-then-(AMOUNT) pairs and takes whatever precedes
    each parenthesis as that opportunity's name, which gets both right.
    """
    if not account_crm or account_crm == NA:
        return []
    out = []
    for match in re.finditer(r"([^;()]+?)\s*\(([^)]*\$[^)]*)\)", account_crm):
        name, inside = match.group(1).strip(), match.group(2)
        # A name picked up mid-string starts with the separator that
        # preceded it — Notion's second is "+ Renewal".
        name = re.sub(r"^[+&]\s*|^and\s+", "", name).strip()
        # "Active X opp" -> "X". Skipped when the name opens with a count,
        # where trimming both ends turns "9 active opps" into "9 active".
        if not re.match(r"^\d", name):
            name = re.sub(r"^active\s+", "", name, flags=re.I)
            name = re.sub(r"\s+opps?$", "", name, flags=re.I)
        if not name:
            continue
        amount = re.search(r"~?\$[\d.,]+[KMB]", inside)
        # Only a known stage name, so "~$41.9M pipeline" doesn't report a
        # stage of "pipeline".
        stage = next((s for s in OPP_STAGES if s.lower() in inside.lower()), "")
        close = re.search(r"close\s+([A-Z][a-z]{2}\s+\d+)", inside)
        opp = {
            "name": name,
            "amount": amount.group(0) if amount else "",
            "stage": stage,
            "close": close.group(1) if close else "",
        }
        # Pre-joined for the template. Built here because the three parts
        # are optional in every combination — two deals have no stage and
        # most have no close date — and joining conditionally is the one
        # thing Nunjucks makes genuinely awkward: it has no list append, so
        # the template would need nested ifs per separator.
        parts = [opp["amount"], opp["stage"]]
        if opp["close"]:
            parts.append("closes %s" % opp["close"])
        opp["meta"] = " · ".join(p for p in parts if p)
        out.append(opp)
    return out


def person_pitch(title):
    lowered = " %s " % title.lower()
    for keywords, pitch in PITCH_BY_TITLE:
        if any(k in lowered for k in keywords):
            return pitch
    return DEFAULT_PITCH


# ── Source: where each record came from ───────────────────────────────
# Neither CSV has a source column. The shared cell macro still renders
# five badge variants (Salesforce, Report, Gong, TechCrunch, ZoomInfo)
# plus a stacked "New Contact" / "New Account" — but with nothing to
# render every row fell to its n/a branch, so the badges disappeared.
#
# This DERIVES a source instead of assigning one arbitrarily. Each rule
# points at something the data actually says, most direct first:
#
#   named in the CRM string   -> Salesforce. Vanta's line names Jordan
#                                Reyes; he is on the opportunity, so his
#                                record is a Salesforce one.
#   named in a signal         -> TechCrunch. The four people the signals
#                                name are there as new hires or
#                                promotions ("New SDR Director Natalie
#                                Ortega"), which is press.
#   exec on a LATE-stage opp  -> Salesforce. Negotiation and Solution
#                                Validation mean a buying committee
#                                exists, so a CRO / CEO / GM is on it.
#                                Deliberately not "has any opp": at
#                                Discovery nobody senior is attached yet,
#                                and mere existence badged 8 more rows
#                                Salesforce on no evidence.
#   sales-dev leader, and the
#   signals carry a FIGURE    -> Report. "290+ SDRs", "1,174 sales
#                                staff", "20+ GTM tools" are numbers out
#                                of a research document.
#   ops / enablement / mktg   -> Gong. The pain their signals describe
#                                ("Data cleanliness pain acknowledged",
#                                "27% stalled-deal rate") is the kind
#                                that surfaces on a recorded call.
#   none of the above         -> ZoomInfo, and New Contact with it. No
#                                trace in the CRM and none in the signals
#                                is the closest this data comes to
#                                saying "not in the CRM yet".
#
# Reading the result as fact would be wrong: the CSVs never claim
# provenance, and which badge best fits a row is a judgement. What it
# isn't is random — it's derived and deterministic, so a rebuild doesn't
# reshuffle the column.
EXEC_TITLE = re.compile(r"\bCRO\b|\bCEO\b|\bCMO\b|\bCFO\b|^GM,|Head of Global",
                        re.I)
LATE_STAGE = re.compile(r"Negotiation|Solution Validation", re.I)
# "290+", "1,174 sales staff", "8+ GTM tools", "5→1".
RESEARCH_FIGURE = re.compile(
    r"\d+\+|\d[\d,]*\s*(?:SDRs|sales staff|GTM tools)|\d+\s*→\s*\d+", re.I)
SALES_DEV_TITLE = re.compile(
    r"sales dev|sdr|bdr|new biz|new business|outbound|demand gen", re.I)
OPS_TITLE = re.compile(
    r"revops|revenue op|stratops|strategy & ops|gtm finance|gtm fs|"
    r"enablement|marketing", re.I)


def names_person(text, person):
    """Does this prose name this person?

    A surname alone counts. The signals write "New SDR Director Natalie
    Ortega" in full, but the CRM writes "VP RevOps Sarah Chen as
    champion" — matching only the full string would still work there, and
    stop working the moment a line shortens a name. Short surnames are
    skipped: "Ryan", "Moss" and "Lee" collide with ordinary words in
    these strings, and "Lee" alone would match "Solution Validation".
    """
    if not text or text == NA:
        return False
    surname = person.split()[-1]
    return person in text or (len(surname) > 4 and surname in text)


def person_source(person, title, account):
    """(source, is_new_contact) for one prospect. See the note above."""
    crm = clean(account["CRM"])
    signals = clean(account["Signals"])
    if names_person(crm, person):
        return "Salesforce", False
    if names_person(signals, person):
        return "TechCrunch", False
    if EXEC_TITLE.search(title) and LATE_STAGE.search(crm):
        return "Salesforce", False
    if SALES_DEV_TITLE.search(title) and RESEARCH_FIGURE.search(signals):
        return "Report", False
    if OPS_TITLE.search(title):
        return "Gong", False
    return "ZoomInfo", True


def account_source(account):
    """(source, is_new_account) for the account itself.

    Coarser than the per-person rules on purpose — an account has one
    fact about it that bears on provenance, whether it exists in the CRM.
    An open opportunity says it does. An empty CRM column says there is
    no record of it at all, which is what New Account means.

    This is what the 8 accounts with nobody listed against them show,
    since they render as one account row with no person to carry a
    source. The pivot lab shows it for all 15, where Source is an
    account-level column.
    """
    if parse_opps(clean(account["CRM"])):
        return "Salesforce", False
    return "ZoomInfo", True


accounts = read_csv(ACCOUNTS)
prospects = read_csv(PROSPECTS)

# Group people by account, preserving the CSV's order within each.
by_account = {}
for person in prospects:
    by_account.setdefault(clean(person["Account"]), []).append(person)

# Every account named in the prospect CSV should exist in the account CSV;
# a typo on either side would otherwise silently drop people.
known = {clean(a["Account"]) for a in accounts}
orphans = sorted(set(by_account) - known)
if orphans:
    raise SystemExit(
        "These accounts appear in prospects_full.csv but not in "
        "accounts_full.csv: %s" % ", ".join(orphans))

# Every account needs its logo on disk before anything is written, so a
# missing file stops the build instead of shipping a broken image.
missing = [clean(a["Account"]) for a in accounts
           if not os.path.exists(
               os.path.join(LOGO_DIR_ABS, slugify(clean(a["Account"])) + ".png"))]
if missing:
    raise SystemExit(
        "No logo found in %s for: %s\nExpected <account name slugified>.png "
        "— e.g. salesforce.com -> salesforce-com.png"
        % (os.path.relpath(LOGO_DIR_ABS, ROOT), ", ".join(missing)))

rows = []        # FLAT — one per prospect
pivot_rows = []  # PIVOT — one per account
for index, account in enumerate(accounts):
    name = clean(account["Account"])
    logo = slugify(name)
    signals = semis(account["Signals"])
    account_src, is_new_account = account_source(account)

    # Fields that describe the ACCOUNT, repeated onto each of its people.
    shared = {
        "company": name,
        "companyLogoUrl": "%s/%s.png" % (LOGO_DIR_URL, logo),

        # Firmographics. These were n/a until the account CSV was restored
        # to its full 13 columns — the copy in this directory had been
        # reduced to 10 and was missing exactly these three. Sizes carry
        # the source's "~" ("~7,000"), which is honest: they're estimates,
        # and rewriting them as exact figures would claim precision the
        # data doesn't have.
        "employees": clean(account["Employees"]),
        "industry": clean(account["Industry"]),
        "location": clean(account["Location"]),

        # "Why Now / Why Not Red" answers the existing column's question.
        "whyProspect": clean(account["Why Now / Why Not Red"]),
        "signals": signals,
        "signal": signals[0] if signals else NA,

        "lastTouch": NA,
        "lastTouchIso": "",
        "owner": NA,

        # Account-grained provenance. Prospect rows overwrite `source`
        # with the person's own below; this is what the account-only rows
        # show, and what the pivot lab's account-level column shows.
        "source": account_src,
        "isNewAccount": is_new_account,

        "rank": clean(account["Rank"]),
        "tier": clean(account["Tier"]),
        "accountId": clean(account["Account ID"]),
        "icpFit": clean(account["ICP Fit"]),
        "crm": clean(account["CRM"]),

        # The same CRM string, split into the deals it names. Kept beside
        # the raw string rather than replacing it: the flat and pivot labs
        # print the sentence, and the group lab lays out the parts.
        #
        # ACCOUNT-level, deliberately, even though the group lab renders
        # it in a per-person column — the opportunities belong to the
        # account, so every person at Notion shows Notion's two. Copying
        # the list onto each person would have implied otherwise.
        "opportunities": parse_opps(clean(account["CRM"])),

        "pitch": clean(account["Recommended Pitch"]),
        "themes": clean(account["Themes"]),
    }

    people = by_account.get(name, [])

    # Provenance per person, resolved once and read by both shapes below.
    #
    # Indexed by POSITION, not by Record ID. Record ID is not unique:
    # Vanta's three people all carry the literal "CRM existing" in that
    # column instead of an id, so a dict keyed on it collapsed them into
    # one entry and handed all three the last one's badge — which quietly
    # cost Jordan Reyes the Salesforce badge his own CRM line earns him.
    person_src = [person_source(clean(p["Prospect Name"]),
                                clean(p["Title"]), account)
                  for p in people]

    # ── PIVOT row: the account once, its people nested ────────────────
    # Emitted for every account including the empty ones, which is the
    # pivot's one clear advantage — an account with nobody against it is
    # a row with empty prospect slots rather than a fake person.
    # `pitch` here is per-PERSON and only exists on this nested array — the
    # flat table's `pitch` column still shows the account's own string,
    # untouched, so the other two labs are unaffected by it. See the
    # synthesis note above.
    pivot_rows.append(dict(shared, **{
        "id": "acct-%02d" % (index + 1),
        "prospectCount": len(people),
        "prospects": [{
            "name": clean(p["Prospect Name"]),
            "role": clean(p["Title"]),
            "email": clean(p["Email"]),
            "phone": clean(p["Phone"]),
            "recordId": clean(p["Record ID"]),
            "recordType": clean(p["Record Type"]),
            "icon": "lead" if clean(p["Record Type"]).lower() == "lead" else "contact",
            "pitch": person_pitch(clean(p["Title"])),
            # Per-person, so a group lab row badges its own provenance
            # rather than repeating the account's.
            "source": person_src[order][0],
            "isNewContact": person_src[order][1],
        } for order, p in enumerate(people)],
    }))

    if not people:
        if not KEEP_ACCOUNTS_WITHOUT_PROSPECTS:
            continue
        row = dict(shared)
        row.update({
            "id": "acct-%02d" % (index + 1),
            "prospect": NA,
            "role": NA,
            "email": NA,
            "phone": NA,
            "recordId": NA,
            "recordType": NA,
            # An account glyph, not a person one. With a contact avatar
            # over four n/a lines the row read as a contact that failed
            # to load, rather than as an account nobody is listed
            # against — which is what it is.
            "icon": "account",
        })
        rows.append(row)
        continue

    for order, person in enumerate(people):
        record_type = clean(person["Record Type"])
        row = dict(shared)
        row.update({
            "id": "acct-%02d-p%02d" % (index + 1, order + 1),

            "prospect": clean(person["Prospect Name"]),
            "role": clean(person["Title"]),

            # Arrived with the prospect CSV's third pass. The templates
            # linkify these as mailto:/tel: only when they aren't n/a,
            # which still matters: the 8 accounts with nobody listed have
            # no person to carry either.
            "email": clean(person["Email"]),
            "phone": clean(person["Phone"]),

            "recordId": clean(person["Record ID"]),
            "recordType": record_type,

            # Now driven by the data instead of alternating: the sprite
            # has a glyph per record type, and the CSV says which.
            "icon": "lead" if record_type.lower() == "lead" else "contact",

            # The person's own provenance replaces the account's, which
            # `shared` put here — this row is a person, so the badge
            # should say where that record came from.
            "source": person_src[order][0],
            "isNewContact": person_src[order][1],
        })
        rows.append(row)

# Rule 4 — nothing removed. `Record ID` / `Record Type` are appended for
# the person-level CSV; Rank and Tier stay next to the frozen name column
# so the account's ranking is readable without scrolling sideways.
columns = [
    {"id": "prospect",    "label": "Prospect"},
    {"id": "rank",        "label": "Rank"},
    {"id": "tier",        "label": "Tier"},
    {"id": "company",     "label": "Company"},
    {"id": "whyProspect", "label": "Why this prospect?"},
    {"id": "signal",      "label": "Signal"},
    {"id": "lastTouch",   "label": "Last touch"},
    {"id": "source",      "label": "Source"},
    {"id": "owner",       "label": "Owner"},
    {"id": "actions",     "label": "Actions"},
    {"id": "icpFit",      "label": "ICP Fit"},
    {"id": "crm",         "label": "CRM"},
    {"id": "pitch",       "label": "Recommended Pitch"},
    {"id": "themes",      "label": "Themes"},
    {"id": "recordType",  "label": "Record Type"},
    {"id": "recordId",    "label": "Record ID"},
    {"id": "accountId",   "label": "Account ID"},
]

HEADER = '''// ──────────────────────────────────────────────────────────────────────
// Prospect table LAB — page data
// ──────────────────────────────────────────────────────────────────────
// GENERATED. Do not hand-edit — edit the CSVs and re-run:
//     python3 tools/lab-data/build_lab_data.py
//
// Sources: tools/lab-data/accounts_full.csv  (15 accounts)
//          tools/lab-data/prospects_full.csv (36 people, 7 accounts)
//
// Gulp injects this into prospect_table_lab.html on the filename match
// (see `getData` in gulpfile.js). It's a separate file from index.json on
// purpose: index.json feeds the LIVE conversation page, so putting lab
// data there would change the demo.
//
// Shape notes:
//   • One row per prospect. Account-level fields (rank, tier, signals,
//     pitch, …) repeat across that account's people.
//   • The 8 accounts with nobody listed are kept as single placeholder
//     rows with the person fields "n/a", so all 15 accounts stay visible.
//   • "n/a" is the marker for anything the CSVs don't carry — now just
//     Last touch and Owner. The templates render it muted, and never
//     linkify it.
//   • Source is NOT in either CSV either, but it isn't n/a: it's derived
//     per person from what the CRM and Signals strings say about them,
//     so the Source column shows badges instead of 44 muted "n/a"s. The
//     rules, and what's real about them, are in the generator.
//   • Employees / Industry / Location and Email / Phone were all on that
//     list until the CSVs were extended: the account CSV was restored to
//     its full 13 columns, and the prospect CSV gained Email and Phone.
//     The only n/a left on those five is the 8 accounts with nobody
//     listed, which have no person to have an address.
//   • Vanta's three people carry the literal "CRM existing" in place of a
//     record id. Passed through as written rather than blanked, since
//     that is what the source says.
//   • companyLogoUrl points at company-logos/accounts/, the real marks —
//     a separate folder from the fictional ones the live demo uses.
// ──────────────────────────────────────────────────────────────────────
'''

table = {
    "id": "lab-accounts",
    "ariaLabel": "Prospects across target accounts, ranked by account tier",
    "columns": columns,
    "rows": rows,
}

with open(OUT_FLAT, "w", encoding="utf-8") as handle:
    handle.write(HEADER)
    handle.write(json.dumps({"table": table}, indent=2, ensure_ascii=False))
    handle.write("\n")


# ══ PIVOT ═════════════════════════════════════════════════════════════
# One row per account, its people across numbered Prospect columns.
#
# The column count is set by the WIDEST account, not by a chosen number:
# Notion has 10 people, so the table needs 10 Prospect columns and the
# other 14 accounts leave most of them empty. That sparseness is the
# finding, so it's rendered rather than capped — a cap would hide people
# and make the shape look better than it is.
max_prospects = max((len(by_account.get(clean(a["Account"]), []))
                     for a in accounts), default=0)

pivot_columns = [{"id": "company", "label": "Company"}]
# `isProspect` is an explicit boolean rather than something the template
# infers. Nunjucks has no reliable "is this key absent" test — an earlier
# `col.prospectIndex is not none` was true for EVERY non-company column,
# so all seven account-level columns rendered as empty prospect cells.
pivot_columns += [{"id": "prospect%d" % n, "label": "Prospect %d" % n,
                   "isProspect": True, "prospectIndex": n - 1}
                  for n in range(1, max_prospects + 1)]
# The same account-level columns the flat table shows, in the same order,
# so the two pages differ only in how the people are laid out.
pivot_columns += [
    {"id": "tier",        "label": "Tier"},
    {"id": "whyProspect", "label": "Why this prospect?"},
    {"id": "signal",      "label": "Signal"},
    {"id": "source",      "label": "Source"},
    {"id": "icpFit",      "label": "ICP Fit"},
    {"id": "crm",         "label": "CRM"},
    {"id": "pitch",       "label": "Recommended Pitch"},
]

HEADER_PIVOT = '''// ──────────────────────────────────────────────────────────────────────
// Prospect PIVOT lab — page data
// ──────────────────────────────────────────────────────────────────────
// GENERATED. Do not hand-edit — edit the CSVs and re-run:
//     python3 tools/lab-data/build_lab_data.py
//
// Same join as prospect_table_lab.json, pivoted: one row per ACCOUNT,
// with its people nested in `prospects` and spread across numbered
// Prospect columns. Gulp injects this into prospect_pivot_lab.html.
//
// Shape notes:
//   • 15 rows, one per account, in rank order. Accounts with nobody
//     listed are rows with every prospect slot empty — no placeholder
//     person, which is what the flat table has to invent.
//   • `columns` carries %d Prospect columns because Notion has %d
//     people. Every other account leaves slots empty; Vanta, Stripe and
//     Acme Corp fill 3 of %d.
//   • Each Prospect column carries `prospectIndex`, its 0-based slot in
//     a row's `prospects` array, so the template indexes rather than
//     parsing the column id.
//   • Account-level fields are NOT repeated here — that's the point of
//     the pivot. They appear once per row, after the people.
//   • `opportunities` is the CRM string parsed into the deals it names —
//     name, amount, stage, close date. Real data, only structured, and
//     account-level like the string it came from: the group lab shows
//     the account's deals in each of its people's CRM cells.
//   • Each nested person also carries `pitch`, which the group lab
//     renders per person. That one IS synthesized — derived from the job
//     title, since the CSV has a pitch per account. Deterministic, so
//     the layout doesn't shift on rebuild, but placeholder copy.
// ──────────────────────────────────────────────────────────────────────
''' % (max_prospects, max_prospects, max_prospects)

pivot_table = {
    "id": "lab-pivot",
    "ariaLabel": "Target accounts with their prospects, ranked by account tier",
    "maxProspects": max_prospects,
    "columns": pivot_columns,
    "rows": pivot_rows,
}

with open(OUT_PIVOT, "w", encoding="utf-8") as handle:
    handle.write(HEADER_PIVOT)
    handle.write(json.dumps({"table": pivot_table}, indent=2, ensure_ascii=False))
    handle.write("\n")


# ── Report, so a regeneration is auditable at a glance ────────────────
real = [r for r in rows if r["prospect"] != NA]
placeholder = [r for r in rows if r["prospect"] == NA]

print("wrote %s" % os.path.relpath(OUT_FLAT, ROOT))
print("  FLAT  %d rows = %d prospects + %d accounts with nobody listed"
      % (len(rows), len(real), len(placeholder)))
print("        %d columns" % len(columns))
print("wrote %s" % os.path.relpath(OUT_PIVOT, ROOT))
print("  PIVOT %d rows, one per account" % len(pivot_rows))
print("        %d columns = 1 company + %d prospect + %d account-level"
      % (len(pivot_columns), max_prospects, len(pivot_columns) - 1 - max_prospects))
filled = sum(r["prospectCount"] for r in pivot_rows)
slots = len(pivot_rows) * max_prospects
print("        %d of %d prospect slots filled (%d%% empty)"
      % (filled, slots, round(100 * (slots - filled) / slots)))

print("\nrows per account:")
for account in accounts:
    name = clean(account["Account"])
    count = len(by_account.get(name, []))
    print("  %-2s %-8s %-22s %s" % (
        clean(account["Rank"]), clean(account["Tier"]), name,
        ("%d prospects" % count) if count else "— placeholder row"))

print("\nn/a per field (of %d rows):" % len(rows))
for key in ["prospect", "role", "email", "phone", "recordId", "recordType",
            "employees", "industry", "location", "lastTouch", "source",
            "owner", "icpFit", "whyProspect", "crm", "pitch", "themes"]:
    count = sum(1 for r in rows if r.get(key) == NA)
    if count:
        print("  %-12s %d" % (key, count))
