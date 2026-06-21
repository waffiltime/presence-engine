import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several tests exercise the real shared SQLite file (presence.db) and wipe
    // whole tables in beforeEach. Run test files serially so they cannot clobber
    // each other's rows under parallel execution. The suite is small; the cost is
    // negligible and it removes a class of flaky cross-file DB races.
    fileParallelism: false,
  },
});
