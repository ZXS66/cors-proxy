mkdir -p .logs

# Running TypeScript Natively requires v22.18.0 or later
# https://nodejs.org/en/learn/typescript/run-natively
nohup node --env-file=.env index.ts > .logs/$(date +%Y%m%d).log 2>&1 &
