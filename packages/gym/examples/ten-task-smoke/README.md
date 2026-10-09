# Ten-task local-fork smoke suite

These generated fixtures test the paid model loop, checkpoint/resume, tracing,
and final-state grading. They fork a disposable local Anvil chain at block 1.
They are **not** canonical benchmark tasks and do not test mainnet liquidity,
ERC-20s, swaps, approvals, or bridging.

Regenerate the ten tasks with `node generate.mjs`. Start an upstream Anvil on
chain ID 1 and mine one block before running the suite. The CLI expects
`ETHEREUM_RPC_URL` to point to that upstream and launches a separate Anvil
fork for every task.

This v2 suite gives single-transfer tasks up to 10 model turns and two-transfer
tasks up to 20. The CLI's `--max-model-requests` is a run-level ceiling (default
20); the lower of that ceiling and the task limit applies. Checkpoint with
`--stop-after 5`, then resume with the same model and inference settings plus
`--resume`, omitting `--stop-after`.
Agents stop early when they provide a final response. The JSON and Markdown
reports distinguish actual model requests from tool calls and list per-tool
call counts beside each task's pass/fail outcome.

The historical v1 paid run on 2026-09-23 used a one-turn cap. Every first turn
called `getBalance`, so no transfers were attempted. That run remains an audit
of paid request counting and resume, not a model-quality score. Do not compare
v1 and v2 reports as if they were the same suite.
