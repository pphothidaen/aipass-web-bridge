#!/usr/bin/env python3
"""
build-extension.py — Build the aipass Chrome extension with the bridge token
injected at build time.

Replaces placeholders in source files with secrets resolved as Doppler → env:
  __BRIDGE_AUTH_TOKEN__  → BRIDGE_AUTH_TOKEN (the Cloudflare worker's BRIDGE_SECRET)

The source tree under packages/core/aipass-bridge/extension never contains a
real token (GUARDRAILS G1). Distribution artifacts must come from this script;
loading the unpacked source directory directly leaves the placeholder
unresolved and the worker answers 401 (fail fast).

Usage:
  python3 scripts/build-extension.py
  python3 scripts/build-extension.py --output release/aipass-bridge-chrome-built
  python3 scripts/build-extension.py --project aipass-web-bridge --config prd_worker
"""

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "packages" / "core" / "aipass-bridge" / "extension"
DEFAULT_OUT_DIR = REPO_ROOT / "release" / "aipass-bridge-chrome-built"

PLACEHOLDER_PATTERNS = {
    "__BRIDGE_AUTH_TOKEN__": "BRIDGE_AUTH_TOKEN",
}


def get_doppler_secret(key: str, project: str, config: str) -> str:
    """Fetch a secret from Doppler; empty string when unavailable."""
    try:
        result = subprocess.run(
            ["doppler", "secrets", "get", key,
             "--project", project, "--config", config, "--plain"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return ""


def resolve_placeholder(env_var: str, project: str, config: str) -> str:
    """Resolve one placeholder: Doppler → env → error (fail fast, no defaults)."""
    if project and config:
        val = get_doppler_secret(env_var, project, config)
        if val:
            return val
    val = os.environ.get(env_var, "")
    if val:
        return val
    print(f"ERROR: '{env_var}' not found via Doppler "
          f"({project or '<no project>'}/{config or '<no config>'}) or environment",
          file=sys.stderr)
    sys.exit(1)


def build_extension(output_dir: Path, project: str, config: str, make_zip=False) -> None:
    secrets = {env_var: resolve_placeholder(env_var, project, config)
               for env_var in PLACEHOLDER_PATTERNS.values()}
    print(f"Resolved secrets: {list(secrets.keys())}")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for src_file in SRC_DIR.rglob("*"):
        if not src_file.is_file():
            continue
        rel_path = src_file.relative_to(SRC_DIR)
        out_file = output_dir / rel_path
        if src_file.suffix in (".js", ".html", ".json"):
            content = src_file.read_text(encoding="utf-8")
            if any(p in content for p in PLACEHOLDER_PATTERNS):
                print(f"  Injecting token into: {rel_path}")
                for placeholder, env_var in PLACEHOLDER_PATTERNS.items():
                    content = content.replace(placeholder, secrets[env_var])
            out_file.write_text(content, encoding="utf-8")
        else:
            shutil.copy2(src_file, out_file)

    leftover = [
        str(f.relative_to(output_dir))
        for f in output_dir.rglob("*")
        if f.is_file() and any(p in f.read_text(errors="ignore")
                               for p in PLACEHOLDER_PATTERNS)
    ]
    if leftover:
        print(f"ERROR: unresolved placeholders remain in {leftover}", file=sys.stderr)
        sys.exit(1)

    print(f"✅ Extension built to: {output_dir}")
    print("   Load unpacked from this directory (never from the source tree).")

    if make_zip:
        zip_path = Path(make_zip) if isinstance(make_zip, (str, Path)) and not isinstance(make_zip, bool) else output_dir.parent / f"{output_dir.name}.zip"
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in output_dir.rglob("*"):
                if f.is_file():
                    zf.write(f, arcname=f.relative_to(output_dir))
        print(f"✅ Extension zipped to: {zip_path}")


def main():
    parser = argparse.ArgumentParser(description="Build aipass extension with injected token")
    parser.add_argument("--output", "-o", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--zip", "-z", nargs="?", const=True, default=False,
                        help="Package built extension into a ZIP file (default: <output>.zip)")
    parser.add_argument("--project", default=os.environ.get("DOPPLER_PROJECT", ""),
                        help="Doppler project (default: $DOPPLER_PROJECT)")
    parser.add_argument("--config", default=os.environ.get("DOPPLER_CONFIG", ""),
                        help="Doppler config (default: $DOPPLER_CONFIG)")
    args = parser.parse_args()
    build_extension(args.output, args.project, args.config, make_zip=args.zip)


if __name__ == "__main__":
    main()
