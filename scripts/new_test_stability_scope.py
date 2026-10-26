#!/usr/bin/env python3
"""List test files a non-leaf PR adds or modifies for the stability repeat gate.

The existing leaf-test path (ci.yml LEAF_REPEAT loop + leaf_test_scope.py)
already repeats test-only diffs.  This script covers the gap: a PR that adds
source changes alongside new or modified test files.

Outputs one repo-relative path per line, e.g. ``test/test_foo.py``.
Exits with nothing when the set is empty.

Consumes STABILITY_BASE_REF (the PR's base.sha from the CI event payload)
or the ``--base`` argument.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# leaf_test_scope and ratchet_scope live in the same scripts/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from leaf_test_scope import _LEAF_NAME, REPO_ROOT, corpus_gates  # noqa: E402
from ratchet_scope import changed_paths_at  # noqa: E402


def _merge_base(raw: str) -> str:
    """Return the merge-base of *raw* with HEAD; fall back to *raw* itself."""
    proc = subprocess.run(
        ["git", "merge-base", raw, "HEAD"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip() if proc.returncode == 0 and proc.stdout.strip() else raw


def filter_stability_scope(paths: list[str], gates: set[str]) -> list[str]:
    """Return paths that are leaf test modules, not corpus gates or helpers.

    A leaf test module matches ``test_*.py`` directly under ``test/``.
    ``conftest.py``, shared helpers, data files and corpus-scanning gates are
    all excluded.  Pure function: testable without git or disk I/O.
    """
    result = []
    for path in paths:
        if not path.startswith("test/"):
            continue
        name = path[len("test/") :]
        if not _LEAF_NAME.match(name):
            continue
        if path in gates:
            continue
        result.append(path)
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default="",
        help="base SHA (default: $STABILITY_BASE_REF)",
    )
    args = parser.parse_args(argv)

    base = args.base or os.environ.get("STABILITY_BASE_REF", "")
    if not base:
        print("error: pass --base <sha> or set STABILITY_BASE_REF", file=sys.stderr)
        return 2

    resolved = _merge_base(base)
    gates = set(corpus_gates(REPO_ROOT))
    for path in filter_stability_scope(changed_paths_at(resolved), gates):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
