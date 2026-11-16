#!/usr/bin/env python3
"""Checks MAPPING.json against docs/USE_CASES.md and docs/REQUIREMENTS.md.

  - every use case maps to at least one requirement and is verified by at least one test case
  - every requirement is verified by at least one test case
  - every test case maps to at least one requirement or use case
  - every id used exists in the docs
Also reports how many of the test cases that cover a requirement are manual and not yet run: a requirement
covered only by an unrun manual test is a smell (coverage on paper, no evidence).
Run from vfm-preview/: python3 tools/check_mapping.py
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
m = json.loads((ROOT / "MAPPING.json").read_text(encoding="utf8"))
ucs_doc = set(re.findall(r"\|\s*(UC-\d+)\s*\|", (ROOT / "docs/USE_CASES.md").read_text(encoding="utf8")))
reqs_doc = set(re.findall(r"\|\s*(REQ-\d+)\s*\|", (ROOT / "docs/REQUIREMENTS.md").read_text(encoding="utf8")))
tests = m["test_cases"]
errors, notes = [], []

for uc, reqs in m["use_cases"].items():
    if uc not in ucs_doc: errors.append(f"{uc} is not in USE_CASES.md")
    if not reqs: errors.append(f"{uc} maps to no requirement")
    for r in reqs:
        if r not in reqs_doc: errors.append(f"{uc} maps to unknown {r}")
for uc in sorted(ucs_doc - set(m["use_cases"])): errors.append(f"{uc} is missing from the mapping")

by_req, by_uc = {}, {}
for tid, t in tests.items():
    if not t["requirements"] and not t["use_cases"]: errors.append(f"test case without requirement or use case: {tid}")
    for r in t["requirements"]:
        if r not in reqs_doc: errors.append(f"{tid} names unknown {r}")
        by_req.setdefault(r, []).append(tid)
    for u in t["use_cases"]:
        if u not in ucs_doc: errors.append(f"{tid} names unknown {u}")
        by_uc.setdefault(u, []).append(tid)

for r in sorted(reqs_doc):
    if r not in by_req: errors.append(f"{r} has no test case")
    elif all(tests[t]["kind"] == "manual" for t in by_req[r]): notes.append(f"{r}: verified only by manual test case(s) not yet run: {', '.join(t.split('/')[-1] for t in by_req[r])}")
for u in sorted(ucs_doc):
    if u not in by_uc: errors.append(f"{u} has no test case")
for u, reqs in m["use_cases"].items():
    for r in reqs:
        if r not in by_req: continue
for r in sorted(reqs_doc):  # a requirement not under any use case
    if not any(r in reqs for reqs in m["use_cases"].values()): errors.append(f"{r} is not needed by any use case")

auto = sum(t["kind"] == "automated" for t in tests.values())
print(f"{len(ucs_doc)} use cases, {len(reqs_doc)} requirements, {len(tests)} test cases ({auto} automated, {len(tests) - auto} manual)")
covered_auto = {r for r, ts in by_req.items() if any(tests[t]["kind"] == "automated" for t in ts)}
print(f"requirements verified by at least one automated test: {len(covered_auto)}/{len(reqs_doc)} ({100 * len(covered_auto) // len(reqs_doc)}%)")
for n in notes: print("note:", n)
for e in errors: print("ERROR:", e)
sys.exit(1 if errors else 0)
