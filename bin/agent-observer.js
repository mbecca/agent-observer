#!/usr/bin/env node
/**
 * Executable entry point.
 *
 * npm creates the platform shims around this file, so the same script works
 * from bash, PowerShell and cmd.exe.
 */

import { main } from '../src/cli.js';

// Writing to a closed pipe (`agent-observer sessions | head`) is not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
});

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`agent-observer: ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
