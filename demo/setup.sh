#!/usr/bin/env bash
# Builds a throwaway sample repo with realistic bloat so `vhs demo.tape` records
# a demo that actually shows findings. Safe: everything lives under /tmp.
set -e

DEMO=/tmp/ctxdiet-demo
rm -rf "$DEMO"
mkdir -p "$DEMO/node_modules/react" "$DEMO/dist"

cat > "$DEMO/CLAUDE.md" <<'EOF'
# Project rules

## Code style
- Always write a unit test before implementing a new feature in this codebase.
- Always write a unit test before you implement a new feature in this codebase.
- Prefer composition over inheritance across all modules.
- Prefer composition over inheritance across all modules.
- Never assume external input is valid; validate it explicitly.
EOF

# Heavy dirs that are not ignored, so the scan has something to cut.
head -c 120000 /dev/zero | tr '\0' a > "$DEMO/node_modules/react/index.js"
head -c 40000  /dev/zero | tr '\0' b > "$DEMO/dist/bundle.js"
