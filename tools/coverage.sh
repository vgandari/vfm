#!/bin/sh
# Line coverage of the library's sources that the tests import directly (Node's built-in V8 coverage).
# Usage: tools/coverage.sh   (from vfm/). Prints the report; compare the "all files" line before and after a change.
exec node --experimental-transform-types --import ./test/register.mjs --disable-warning=ExperimentalWarning --test-reporter=spec \
  --experimental-test-coverage --test-coverage-exclude='tests/**' --test-coverage-exclude='test/**' --test-coverage-exclude='node_modules/**' \
  --test "test/*.test.ts" "tests/*.test.ts" 2>&1 | sed -n '/start of coverage report/,/end of coverage report/p'
