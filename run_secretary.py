"""
Wrapper script for the Middle Gateway / Secretary.

Usage:
    python3 run_secretary.py run "Enhance monitor.py..."
    python3 run_secretary.py dry-run "Enhance monitor.py..."
    python3 run_secretary.py skills list
    python3 run_secretary.py skills show <hash>
"""
import sys
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "packages"))

from packages.__main__ import main

if __name__ == "__main__":
    main()
