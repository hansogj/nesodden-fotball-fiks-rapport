#!/bin/bash
# Nightly FIKS sync + rebuild + redeploy
# Add to system crontab: crontab -e
#   3 2 * * * /git/systek/claud-workshop/fiks-rapport/scripts/nightly-sync.sh
#
# Requires: .auth/fiks.json (run npx playwright test --project=fiks-setup to regenerate)

set -e
cd /git/systek/claud-workshop/fiks-rapport

LOG="/tmp/fiks-sync-$(date +%Y%m%d).log"
echo "=== FIKS sync started $(date) ===" | tee "$LOG"

# Run sync
npx playwright test --project=sync 2>&1 | tee -a "$LOG"
SYNC_EXIT=${PIPESTATUS[0]}

if [ $SYNC_EXIT -ne 0 ]; then
  echo "=== SYNC FAILED (exit $SYNC_EXIT) ===" | tee -a "$LOG"
  exit 1
fi

# Rebuild
echo "=== Rebuilding ===" | tee -a "$LOG"
npm run build 2>&1 | tee -a "$LOG"

# Redeploy
echo "=== Redeploying ===" | tee -a "$LOG"
fuser -k 3210/tcp 2>/dev/null || true
sleep 2
npm run start >> /tmp/next-app.log 2>&1 &
sleep 3

if curl -s -o /dev/null -w '%{http_code}' http://localhost:3210 | grep -q 200; then
  echo "=== Deploy OK $(date) ===" | tee -a "$LOG"
else
  echo "=== Deploy FAILED ===" | tee -a "$LOG"
  exit 1
fi
