"""Shared defaults for the continuous GA observation gate."""

from __future__ import annotations


# The stability definition requires a complete two-week window.  Keep these
# values in one module so preflight and evaluation cannot silently drift.
DEFAULT_OBSERVATION_DAYS = 14
DEFAULT_MIN_SUCCESS_RATE = 0.9
DEFAULT_MIN_FINISHED_RUNS = 1
