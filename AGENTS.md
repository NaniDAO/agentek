# Repository instructions

## Dependency versions

Keep external dependencies, development dependencies, optional dependencies, peer
dependencies and pnpm overrides pinned to exact versions. Workspace references
may use the workspace protocol. Keep save-exact enabled, update the lockfile with
manifest edits, and run `pnpm check:pins`. Do not silently upgrade packages when
pinning existing versions.

## Test execution

Run one test command at a time, with runner concurrency limited to one worker or
thread. Disable parallel execution, sharding and concurrent test builds, and wait
for each command to finish before starting another. This machine has limited memory.
