#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$project_root/.cache/ubereats"
upstream_commit=a918dea4da9c658607afb70784b7feeda7cf458d
requirements="$project_root/scripts/ubereats-diagnostic-requirements.txt"

mkdir -p "$runtime_dir"
if [ ! -d "$runtime_dir/source/.git" ]; then
  git clone --quiet https://github.com/omkarcloud/uber-eats-scraper.git "$runtime_dir/source"
fi
if [ "$(git -C "$runtime_dir/source" rev-parse HEAD)" != "$upstream_commit" ]; then
  git -C "$runtime_dir/source" fetch --quiet origin "$upstream_commit"
  git -C "$runtime_dir/source" checkout --quiet --detach "$upstream_commit"
fi
if [ ! -x "$runtime_dir/venv/bin/python" ]; then
  python3 -m venv "$runtime_dir/venv"
fi
if ! cmp -s "$requirements" "$runtime_dir/installed-requirements.txt"; then
  "$runtime_dir/venv/bin/python" -m pip install -r "$requirements"
  cp "$requirements" "$runtime_dir/installed-requirements.txt"
fi
