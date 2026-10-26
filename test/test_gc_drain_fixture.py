"""Verify the mechanism _drain_gc_cycles in the root conftest relies on.

The autouse _drain_gc_cycles fixture calls gc.collect() twice after each test so
that cyclic garbage a test leaves behind is freed before the next test starts.
CPython's reference counter alone cannot free a self-referential object; only the
cyclic collector can. This test disables automatic collection, builds such a cycle,
shows it survives the local name being dropped, then runs the same two
gc.collect() calls the fixture makes and shows the object is freed.
"""

from __future__ import annotations

import gc
import weakref


def test_gc_collect_twice_clears_reference_cycle() -> None:
    """A self-referential object survives refcounting and is freed by gc.collect() x2."""

    class _Tracked:
        back: _Tracked | None = None

    gc.disable()
    try:
        obj = _Tracked()
        obj.back = obj  # cycle: obj -> obj keeps the refcount above zero
        ref = weakref.ref(obj)
        del obj

        assert ref() is not None, "refcounting alone must not free a reference cycle"

        # The same calls _drain_gc_cycles makes after each test.
        gc.collect()
        gc.collect()

        assert ref() is None, "gc.collect() twice did not clear the reference cycle"
    finally:
        gc.enable()
