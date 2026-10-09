# Agentek Gym suites

The Gym accepts task files from a separate benchmark repository (for example,
`../agentek-benchmarks`). A suite
manifest lists task paths in a stable order. Set `expectedTasks` to `100` for
a 100-prompt run; the CLI fails before starting Anvil if the count differs.
Each task starts a fresh, pinned Ethereum fork and uses the task's restricted
Agentek tools. The reference model adapter calls OpenRouter; library callers
can provide any `AgentAdapter`.

```json
{
  "id": "benchmark-v1-public",
  "expectedTasks": 100,
  "tasks": ["tasks/001.yaml", "tasks/002.yaml"]
}
```

The list above is abbreviated; a real manifest must contain all 100 paths.
Paths are relative to the manifest file. The Gym validates the entire suite
before starting the first fork and refuses duplicate task IDs.

From the repository root, with `OPENROUTER_API_KEY` and `ETHEREUM_RPC_URL` in
`.env`, run:

```bash
pnpm --filter @agentek/gym build
node --env-file=.env packages/gym/bin/agentek-gym.mjs run-suite \
  packages/gym/examples/suite.json \
  --model google/gemini-3.8-flash \
  --max-model-requests 6 \
  --max-tokens 1024 --temperature 0.2 \
  --output results/gemini-example
```

The Ethereum RPC is used only as Anvil's fork source. No signer connects to
it. A model run can incur API costs; the deterministic test suite does not use
model APIs.
`--max-model-requests` caps model requests per task (default 20), providing a
predictable upper bound of 2,000 model turns for a 100-task suite before any
provider-side retries. Set a lower value to control costs. The reports record
HTTP request attempts as well as chain-side metrics.
The CLI also accepts `--top-p`, `--seed`, `--model-version` (a declared
version label), `--provider-only`, `--provider-order`, and `--no-fallbacks`.
The requested settings, gateway (`openrouter`), declared version, response
model, and actual serving provider are saved separately. Serving-provider
attribution and billed USD cost are fetched from OpenRouter generation
metadata when available; unknown values remain unknown. These lookups are
not model inference calls. The model version label is user-supplied, not a
cryptographic proof of weights.
OpenRouter may publish generation metadata after its chat response. The
adapter retries delayed metadata lookups for a bounded period. To refresh a
saved report later without making another model request, run:

```bash
node --env-file=.env packages/gym/bin/agentek-gym.mjs reconcile-openrouter \
  results/gemini-example
```

Each output directory contains:

```text
run.json
report.json
report.md
tasks/<task-id>/result.json
tasks/<task-id>/trace.json
```

`report.json` contains the run summary and per-task outcomes. `report.md`
contains the human-readable breakdown. Each task has a compact result and a
tool/transaction/model-generation trace. Correctness, safety, and cost remain
separate dimensions; the Gym does not invent a leaderboard formula. The
report includes a fingerprint of every validated
task definition so saved runs can be compared only when they evaluated the
same tasks in the same order. Secrets supplied through process configuration
are redacted from saved JSON.

Run settings have a separate fingerprint. Without `--output`, output paths
include that fingerprint and a unique run ID, so two runs of the same model
with different settings cannot collide. Explicit output directories are
created atomically and cannot be reused unless `--resume` matches both task
and settings fingerprints. An active run lock prevents concurrent writers.

The runner updates both reports after every task. If a long run stops midway,
repeat the same command with the same output directory and add `--resume`.
Completed task artifacts are checked against their fingerprints and reused,
so those prompts are not billed again. Comparisons reject partial reports.
Resume does **not** automatically retry a task whose failure result and trace
were already saved. An interrupted in-progress task without both artifacts
will run again and may incur new model charges. A hard process kill can leave
`.run.lock` behind; inspect the process before clearing a stale lock. The
reference OpenRouter adapter retries one transient HTTP error, but a suite is
not a general self-healing job queue.

Compare two or more saved reports without making any model or RPC calls:

```bash
node packages/gym/bin/agentek-gym.mjs compare \
  results/gemini-example/report.json \
  results/other-model/report.json \
  --output results/comparison
```

This writes `comparison.json` and `comparison.md`, including pass rates and
per-task wins/losses relative to the first report. The Gym reports correctness
and raw efficiency metrics; benchmark ranking policy belongs in the benchmark
repository.

Multi-chain tasks declare two or more pinned forks, chain-specific wallet
funding, Across spoke pools, and destination balance plus `acrossSettlement`
graders. Set `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, etc. in the process
environment for selected chains; task files never contain RPC credentials.
Safety policies can check transaction targets, reverts, total gas, and balance
floors. `intentWriteContract` is a normal Agentek tool and is exposed only
when a task explicitly allowlists it. Every transaction remains guarded to a
Gym-owned local Anvil RPC.

Across settlement currently means a deterministic recipient balance update
after a genuine origin `V3FundsDeposited` event. The trace marks it
`anvil_state_override`. It does **not** simulate a destination SpokePool fill
transaction, `FilledV3Relay` event, message execution, or relayer repayment.
Those outcomes must not be claimed by benchmark tasks until implemented.

The
reference OpenRouter adapter uses its HTTP tool-calling API because the
repository's installed OpenRouter AI SDK provider targets an older AI SDK
interface; the Gym's `AgentAdapter` remains provider independent.
