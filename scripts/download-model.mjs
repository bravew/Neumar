#!/usr/bin/env node

/**
 * Pre-download the embedding model for bundling with the Tauri app.
 *
 * Downloads onnx-community/gte-multilingual-base (quantized int8 ONNX)
 * and its tokenizer files into src-api/dist/models/ so they can be
 * included in the Tauri bundle via the resources config.
 *
 * Uses @huggingface/transformers AutoTokenizer to download tokenizer
 * files, then downloads the ONNX model file directly from HuggingFace.
 *
 * Usage: node scripts/download-model.mjs
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'src-api', 'dist', 'models');

const MODEL = 'onnx-community/gte-multilingual-base';
const ONNX_FILE = 'onnx/model_quantized.onnx';
const HF_BASE_URL = `https://huggingface.co/${MODEL}/resolve/main`;

/**
 * Download a file from HuggingFace with progress reporting.
 */
async function downloadFile(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`[download-model] Already exists: ${destPath}`);
    return;
  }

  mkdirSync(dirname(destPath), { recursive: true });
  console.log(`[download-model] Downloading: ${url}`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = response.headers.get('content-length');
  const totalMB = contentLength
    ? (parseInt(contentLength) / 1024 / 1024).toFixed(1)
    : '?';
  let downloadedBytes = 0;

  const dest = createWriteStream(destPath);
  const reader = response.body.getReader();

  const writable = new WritableStream({
    write(chunk) {
      downloadedBytes += chunk.length;
      const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r[download-model] Progress: ${mb}/${totalMB} MB`);
      dest.write(chunk);
    },
    close() {
      dest.end();
      console.log('');
    },
  });

  await reader.read().then(function pump({ done, value }) {
    if (done) {
      dest.end();
      console.log('');
      return;
    }
    downloadedBytes += value.length;
    const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
    process.stdout.write(`\r[download-model] Progress: ${mb}/${totalMB} MB`);
    dest.write(value);
    return reader.read().then(pump);
  });
}

async function main() {
  console.log(`[download-model] Downloading ${MODEL} to ${OUTPUT_DIR}...`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Download tokenizer files via AutoTokenizer (handles HF cache structure)
  console.log(`[download-model] Loading tokenizer...`);
  const { AutoTokenizer } = await import('@huggingface/transformers');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL, {
    cache_dir: OUTPUT_DIR,
  });

  // Quick tokenizer sanity check
  const encoded = tokenizer('hello world');
  console.log(
    `[download-model] Tokenizer loaded (${encoded.input_ids.data.length} tokens for "hello world")`,
  );

  // 2. Download ONNX model file
  const onnxDest = join(OUTPUT_DIR, MODEL, ONNX_FILE);
  await downloadFile(`${HF_BASE_URL}/${ONNX_FILE}`, onnxDest);

  console.log(`[download-model] All files downloaded to: ${OUTPUT_DIR}`);
  console.log(`[download-model] ONNX model: ${onnxDest}`);
}

main().catch((err) => {
  console.error('[download-model] Failed:', err);
  process.exit(1);
});
