#!/usr/bin/env python3
"""Report any repo whose vendored Jev client has drifted from the golden copy.

The Jev client is vendored, not packaged: there is one golden copy per language in the seed app
template and a byte-identical copy in every repo that uses it. See ADR 0001. Vendoring is only
safe if drift is visible, and that is this script's whole job.

Three ways to run it.

  Verify this repo against the manifest that travels with the files::

      python3 scripts/jev-sync.py

  Verify other checkouts against THIS repo's copies, which is how the golden repo reports the
  whole fleet in one run::

      python3 scripts/jev-sync.py ../some-app ../another-app

  Re-stamp the manifest after a deliberate change to the golden copy. Run this in the golden
  repo only, then copy every file below out to each repo that vendors the client::

      python3 scripts/jev-sync.py --update

Exit code 0 means clean, 1 means drift or a missing file. No dependencies.
"""

import hashlib
import json
import sys
from pathlib import Path

# Every file that is vendored as a unit. The manifest travels with them, so a copied tree can
# check itself. The manifest is not in the list because it holds the hashes of the others.
VENDORED = [
    "lib/jev.ts",
    "lib/jev.py",
    "lib/jev.test.ts",
    "lib/jev_conformance_test.py",
    "lib/jev-fixtures.json",
]
MANIFEST = "lib/jev.manifest.json"

# A repo that has no runtime for one of the languages vendors only that language's files, and
# its own manifest names the subset it holds. MARIPOSA is the first: it is a Python lab tool
# with no vitest and no node_modules, so `lib/jev.ts` and `lib/jev.test.ts` are not runnable
# there and a copy of a suite nothing can run is a copy nobody checks. Drift is still reported
# for every file the repo's manifest DOES name.


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repo_root() -> Path:
    """The repo this script sits in, not the current working directory."""
    return Path(__file__).resolve().parent.parent


def hashes(root: Path, names: list | None = None) -> dict:
    out = {}
    for name in names or VENDORED:
        path = root / name
        out[name] = digest(path) if path.is_file() else None
    return out


def vendored_names(root: Path) -> list:
    """The files THIS repo vendors, read off its own manifest. Defaults to all of them."""
    manifest_path = root / MANIFEST
    if not manifest_path.is_file():
        return list(VENDORED)
    try:
        named = json.loads(manifest_path.read_text()).get("files", {})
    except ValueError:
        return list(VENDORED)
    subset = [name for name in VENDORED if name in named]
    return subset or list(VENDORED)


def report(label: str, expected: dict, actual: dict, names: list | None = None) -> bool:
    """Print one repo's result. Returns True when it is clean."""
    problems = []
    for name in names or VENDORED:
        want, got = expected.get(name), actual.get(name)
        if got is None:
            problems.append("%s  MISSING" % name)
        elif want is None:
            problems.append("%s  no golden hash recorded" % name)
        elif want != got:
            problems.append("%s  DRIFTED (golden %s, here %s)" % (name, want[:12], got[:12]))
    if problems:
        print("DRIFT  %s" % label)
        for line in problems:
            print("       %s" % line)
        return False
    print("clean  %s" % label)
    return True


def main(argv: list) -> int:
    root = repo_root()
    manifest_path = root / MANIFEST

    if "--update" in argv:
        manifest_path.write_text(
            json.dumps(
                {
                    "_about": (
                        "sha256 of each vendored Jev file, stamped in the golden repo. "
                        "Regenerate with scripts/jev-sync.py --update, then copy every file "
                        "listed here into each repo that vendors the client."
                    ),
                    "files": hashes(root),
                },
                indent=2,
            )
            + "\n"
        )
        print("stamped %s" % MANIFEST)
        return 0

    targets = [Path(a).resolve() for a in argv if not a.startswith("-")]
    if targets:
        # This repo holds the golden copies; compare every named checkout against them.
        golden = hashes(root)
        missing_golden = [n for n, h in golden.items() if h is None]
        if missing_golden:
            print("This repo is not the golden copy: missing %s" % ", ".join(missing_golden))
            return 1
        ok = True
        for target in targets:
            names = vendored_names(target)
            ok = report(str(target), golden, hashes(target, names), names) and ok
        return 0 if ok else 1

    if not manifest_path.is_file():
        print("No %s. Run --update in the golden repo, then copy it here." % MANIFEST)
        return 1
    expected = json.loads(manifest_path.read_text()).get("files", {})
    names = vendored_names(root)
    return 0 if report(str(root), expected, hashes(root, names), names) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
