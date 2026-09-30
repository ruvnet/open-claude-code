#!/usr/bin/env python3
"""Format decompile-diff.json into a markdown summary for release notes."""
import json
import sys

def main():
    diff_file = sys.argv[1] if len(sys.argv) > 1 else "/tmp/decompile-diff.json"
    try:
        d = json.load(open(diff_file))
    except Exception as e:
        print(f"Decompilation diff unavailable: {e}", file=sys.stderr)
        sys.exit(1)

    if d.get("status") != "complete" or d.get("schemaVersion") != 1:
        raise ValueError("A complete validated decompilation diff is required")
    s = d["summary"]
    prev_ver = sys.argv[2] if len(sys.argv) > 2 else "prev"
    new_ver = sys.argv[3] if len(sys.argv) > 3 else "new"

    pm = s.get("prevModules", "?")
    nm = s.get("newModules", "?")
    pf = s.get("prevFunctions", "?")
    nf = s.get("newFunctions", "?")
    pc = s.get("prevClasses", "?")
    nc = s.get("newClasses", "?")

    def delta(a, b):
        try:
            d = int(b) - int(a)
            return f"+{d}" if d >= 0 else str(d)
        except (ValueError, TypeError):
            return "?"

    print("### Source Diff (ruDevolution classification)")
    print()
    print(f"| Metric | v{prev_ver} | v{new_ver} | Delta |")
    print("|--------|---------|---------|-------|")
    print(f"| Classified categories | {pm} | {nm} | {delta(pm, nm)} |")
    print(f"| Function patterns (estimate) | {pf} | {nf} | {delta(pf, nf)} |")
    print(f"| Class patterns (estimate) | {pc} | {nc} | {delta(pc, nc)} |")
    for side in ("previous", "current"):
        proof = d["evidence"][side]
        print(f"<!-- {side}: {proof['sourceModules']} source modules, {proof['sourceBytes']} bytes -->")
    print()
    print("Shipped JavaScript was recovered and syntax-checked without executing it. "
          "Every recovered executable JS module passed through ruDevolution's Node keyword classifier; "
          "all source and classified-content witness hashes were checked. "
          "Categories are source fragments, not independently runnable modules. "
          "Lexical counts are estimates, not recovered original symbol identities or proof of semantic equivalence.")
    for side in ("previous", "current"):
        p = d["evidence"][side]
        print(f"- v{p['version']}: {p['sourceModules']} JavaScript modules, "
              f"{p['sourceBytes']:,} source bytes, {p['witness']['chains']} verified SHA-256 witness chains "
              f"({p['packaging']}); {p['assetCount']} non-executable assets inventoried separately")
    print()

    added = d.get("addedModules", [])
    if added:
        print("#### New Categories")
        for m in added[:15]:
            print(f"- **{m['name']}** ({m.get('functions', 0)} functions, {m.get('classes', 0)} classes)")
        if len(added) > 15:
            print(f"- ...and {len(added) - 15} more")
        print()

    removed = d.get("removedModules", [])
    if removed:
        print("#### Removed Categories")
        for m in removed[:10]:
            print(f"- ~~{m['name']}~~ ({m.get('functions', 0)} functions)")
        print()

    changed = d.get("changedModules", [])
    if changed:
        print("#### Changed Categories (content hashes)")
        for m in sorted(changed, key=lambda x: abs(x.get("sizeDelta", 0)), reverse=True)[:15]:
            sd = m.get("sizeDelta", 0)
            fd = m.get("funcDelta", 0)
            sign_s = "+" if sd >= 0 else ""
            sign_f = "+" if fd >= 0 else ""
            print(f"- **{m['name']}**: {sign_s}{sd} bytes, {sign_f}{fd} functions")
        print()

    exports = d.get("addedExports", [])
    if exports:
        print("#### New Exports")
        for e in exports[:20]:
            print(f"- `{e}`")
        if len(exports) > 20:
            print(f"- ...and {len(exports) - 20} more")
        print()

    removed_exports = d.get("removedExports", [])
    if removed_exports:
        print("#### Removed Exports")
        for e in removed_exports[:20]:
            print(f"- ~~`{e}`~~")
        print()

if __name__ == "__main__":
    main()
