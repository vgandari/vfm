#!/usr/bin/env python3
"""Line coverage of the project's own sources including code the tests run through esbuild bundles.

Runs the test suite with V8 coverage and inline source maps (the test files' bundling options are patched in a
copy of the working tree), then maps every covered or uncovered line of a bundle back to its source line.
Usage (from the repo root; about 4 minutes): python3 tools/coverage_mapped.py [--per-file]
A source line counts when some generated line maps to it; it is covered when any generated line that maps to it ran.
"""
import json, os, re, shutil, subprocess, sys, tempfile, pathlib, glob, base64

ROOT = pathlib.Path.cwd()
work = pathlib.Path(tempfile.mkdtemp(prefix="vfm-cov-"))
cov = work / "v8"
tree = work / "tree"
try:
    files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], capture_output=True, text=True, check=True).stdout.split()
    for f in files:
        if f.startswith("node_modules/") or not (ROOT / f).is_file():
            continue
        (tree / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, tree / f)
    os.symlink(ROOT / "node_modules", tree / "node_modules")
    for f in glob.glob(str(tree / "tests/**/*.ts"), recursive=True) + glob.glob(str(tree / "test/*.ts")):
        t = open(f, encoding="utf8").read()
        if "bundle: true" in t:
            open(f, "w", encoding="utf8").write(t.replace("bundle: true,", 'bundle: true, sourcemap: "inline",'))
    env = dict(os.environ, NODE_V8_COVERAGE=str(cov))
    cmd = ["node", "--experimental-transform-types", "--import", "./test/register.mjs", "--disable-warning=ExperimentalWarning",
           "--enable-source-maps", "--test", *[p for p in ("test/*.test.ts", "tests/*.test.ts") if glob.glob(str(tree / p))]]
    subprocess.run(cmd, cwd=tree, env=env, capture_output=True)

    B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}

    def vlq(seg):
        out, shift, val = [], 0, 0
        for ch in seg:
            d = B64[ch]
            val += (d & 31) << shift
            if d & 32:
                shift += 5
            else:
                out.append(-(val >> 1) if val & 1 else val >> 1)
                shift = val = 0
        return out

    # per source file: line -> [covered?...]
    lines = {}

    def note(src, line, hit):
        lines.setdefault(src, {}).setdefault(line, []).append(hit)

    for jf in glob.glob(str(cov / "*.json")):
        data = json.load(open(jf))
        cache = data.get("source-map-cache", {})
        for res in data["result"]:
            url = res["url"]
            if not url.startswith("file://") or "/node_modules/" in url:
                continue
            path = url[7:]
            sm = cache.get(url)
            # character state: innermost range wins; ranges are given outer first per function
            ranges = [(r["startOffset"], r["endOffset"], r["count"]) for fn in res["functions"] for r in fn["ranges"]]
            ranges.sort(key=lambda r: (r[0], -r[1]))
            if sm and sm.get("data"):
                ll = sm["lineLengths"]
                starts, o = [], 0
                for n in ll:
                    starts.append(o)
                    o += n + 1
                import bisect
                rstarts = [r[0] for r in ranges]
                def hit_at(off):
                    best = None
                    for a, b, c in ranges[:bisect.bisect_right(rstarts, off)]:
                        if off < b:
                            best = c
                    return best is None or best > 0
                # generated line -> covered if its first character is
                class Lazy(dict):
                    def get(self, gl, d=True):
                        if gl not in self:
                            self[gl] = hit_at(starts[gl]) if gl < len(starts) else d
                        return self[gl]
                gen_cov = Lazy()
                m = sm["data"]
                srcs = m["sources"]
                sl = si = 0
                for gl, group in enumerate(m["mappings"].split(";")):
                    sc = 0
                    seen = set()
                    for seg in group.split(","):
                        if not seg:
                            continue
                        v = vlq(seg)
                        sc += v[0]
                        if len(v) >= 4:
                            si += v[1]; sl += v[2]
                            p = srcs[si]
                            if "node_modules" in p:
                                continue
                            name = p[7:] if p.startswith("file://") else p
                            if not name.startswith("/"):
                                name = os.path.normpath(os.path.join(os.path.dirname(path), name))
                            name = os.path.realpath(name)
                            if (si, sl) not in seen:
                                seen.add((si, sl))
                                if name.startswith(os.path.realpath(tree)) and "/tests/" not in name and "/test/" not in name:
                                    note(os.path.relpath(name, os.path.realpath(tree)), sl + 1, gen_cov.get(gl, True))
            elif os.path.realpath(path).startswith(os.path.realpath(tree)) and path.endswith(".ts") and "/tests/" not in path and "/test/" not in path:
                text = open(path, encoding="utf8").read()
                off = 0
                for ln, line in enumerate(text.split("\n"), 1):
                    first = off + (len(line) - len(line.lstrip()))
                    if line.strip() and not re.match(r"\s*(//|/\*|\*)", line):
                        best = None
                        for a, b, c in ranges:
                            if a <= first < b:
                                best = c
                        note(os.path.relpath(os.path.realpath(path), os.path.realpath(tree)), ln, best is None or best > 0)
                    off += len(line) + 1
    rows, tot, hit = [], 0, 0
    for src in sorted(lines):
        if src.startswith(("tests/", "test/")):
            continue
        ls = lines[src]
        n = len(ls); h = sum(1 for v in ls.values() if any(v))
        rows.append((src, h, n)); tot += n; hit += h
    if "--per-file" in sys.argv:
        for src, h, n in rows:
            print(f"{src:40s} {100*h/n:6.2f}%  ({h}/{n})")
    print(f"all files: {100*hit/tot:.2f}%  ({hit}/{tot} lines, {len(rows)} files)")
finally:
    shutil.rmtree(work, ignore_errors=True)
