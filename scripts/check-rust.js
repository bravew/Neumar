#!/usr/bin/env node

/**
 * Pre-flight check for Rust toolchain
 * Required for Tauri desktop app development
 */

import { execSync } from 'child_process';

function checkCommand(cmd, name) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasRustup = checkCommand('rustup', 'rustup');
const hasCargo = checkCommand('cargo', 'cargo');

if (!hasCargo) {
  console.error(`
\x1b[33m╔════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║  ⚠️  Rust toolchain not found                                           ║
║                                                                        ║
║  Tauri requires Rust to build the desktop app.                         ║
║                                                                        ║
║  Install Rust by running:                                              ║
║                                                                        ║
║    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh      ║
║                                                                        ║
║  After installation, restart your terminal and try again.              ║
║                                                                        ║
║  For more info: https://www.rust-lang.org/tools/install                ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝\x1b[0m
`);
  process.exit(1);
}

// Optional: Check rustup for toolchain management
if (!hasRustup) {
  console.warn(
    '\x1b[33m[warn] rustup not found. Consider installing via rustup for easier toolchain management.\x1b[0m',
  );
}

console.log('\x1b[32m✓ Rust toolchain detected\x1b[0m');
