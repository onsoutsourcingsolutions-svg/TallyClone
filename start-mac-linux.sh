#!/usr/bin/env bash
# O.N.S. OUTSOURCING SOLUTIONS - local launcher for macOS & Linux
# Run:  bash start-mac-linux.sh     (macOS: double-click after chmod +x, or right-click -> Open)
set -u
cd "$(dirname "$0")" || exit 1
echo
echo "  ================================================"
echo "    O.N.S. OUTSOURCING SOLUTIONS - starting on this computer"
echo "  ================================================"
echo

need_node() {
  echo
  echo "  [ERROR] Node.js is not installed or too old."
  echo "  Install Node.js v22 LTS from https://nodejs.org"
  echo "  then run this file again."
  exit 1
}

command -v node >/dev/null 2>&1 || need_node
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<5)){process.exit(1)}" >/dev/null 2>&1 || need_node

[ -d node_modules ] || {
  echo "  [step 1/3] Installing packages (first run only, ~1 minute)..."
  npm install --no-audit --no-fund || { echo "  [ERROR] npm install failed - check internet."; exit 1; }
}

[ -f dist/index.html ] || {
  echo "  [step 2/3] Building web app (first run only, ~1 minute)..."
  npm run build || { echo "  [ERROR] build failed."; exit 1; }
}

echo "  [step 3/3] Starting server..."
echo
( node scripts/open-browser.js ) &
npm start
echo
echo "  Server stopped."
