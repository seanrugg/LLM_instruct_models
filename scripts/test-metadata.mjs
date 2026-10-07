/**
 * Test script for file-derived metadata extraction.
 * Tests:
 *   1. GGUF parser: against reference-generated GGUF v3 file
 *   2. Safetensors parser: against reference-generated safetensors file
 *   3. Format detection: unknown format falls through correctly
 *
 * Prerequisites (one-time setup):
 *   python3 -m venv .venv-test
 *   .venv-test/bin/pip install gguf safetensors numpy
 *
 * Run: node scripts/test-metadata.mjs
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// ── Helpers ────────────────────────────────────────────────────

let passCount = 0
let failCount = 0

function assert (condition, message) {
  if (condition) {
    passCount++
    console.log(`  PASS: ${message}`)
  } else {
    failCount++
    console.error(`  FAIL: ${message}`)
  }
}

// ── Generate fixtures with reference writers ───────────────────

async function generateFixtures (outputDir) {
  const genScript = join(import.meta.dirname, 'generate_test_fixtures.py')

  // Resolve Python interpreter: env > venv > system
  const repoRoot = new URL('../', import.meta.url).pathname
  const venvPython = join(repoRoot, '.venv-test', 'bin', 'python3')
  let python
  if (process.env.PYTHON) {
    python = process.env.PYTHON
  } else {
    try {
      await fs.access(venvPython)
      python = venvPython
    } catch {
      python = 'python3'
    }
  }

  try {
    execSync(`${python} "${genScript}" --output-dir "${outputDir}"`, { stdio: 'inherit' })
  } catch (err) {
    console.error('Failed to generate fixtures. Install deps: .venv-test/bin/pip install gguf safetensors numpy')
    throw err
  }
}

// ── Main tests ─────────────────────────────────────────────────

async function runTests () {
  // Dynamic import the parser (same as server.js uses)
  const parserPath = new URL('../frontend/src/lib/modelHeader.mjs', import.meta.url).pathname
  const { parseModelHeader } = await import(parserPath)

  const outputDir = await fs.mkdtemp(join(tmpdir(), 'llm-test-'))

  try {
    await generateFixtures(outputDir)

    const ggufPath = join(outputDir, 'test_model.gguf')
    const stPath = join(outputDir, 'test_model.safetensors')

    // Read files into memory
    const ggufBuffer = await fs.readFile(ggufPath)
    const stBuffer = await fs.readFile(stPath)

    console.log('\n=== Test 1: GGUF v3 Parser (reference-generated) ===\n')

    const readBytes = async (offset, length) => ggufBuffer.slice(offset, offset + length)
    const ggufResult = await parseModelHeader(readBytes, ggufBuffer.length, 'test_model.gguf')

    assert(ggufResult.file_format === 'gguf', 'file_format is gguf')
    assert(ggufResult.architecture === 'llama', `architecture is 'llama' (got '${ggufResult.architecture}')`)
    assert(ggufResult.quantization === 'Q4_K_M', `quantization is 'Q4_K_M' (got '${ggufResult.quantization}')`)
    assert(ggufResult.context_length === 8192, `context_length is 8192 (got ${ggufResult.context_length})`)
    assert(ggufResult.license === 'custom', `license is 'custom' (got '${ggufResult.license}')`)
    assert(ggufResult.source_model_name === 'Llama-3-8B-Instruct', `source_model_name is 'Llama-3-8B-Instruct' (got '${ggufResult.source_model_name}')`)
    assert(
      ggufResult.chat_template && ggufResult.chat_template.includes('messages'),
      'chat_template contains template'
    )
    // parameter_count = 32*16 + 16*16 = 512 + 256 = 768
    assert(ggufResult.parameter_count === 768, `parameter_count is 768 (got ${ggufResult.parameter_count})`)
    assert(Array.isArray(ggufResult.warnings), 'warnings is an array')

    console.log('\n=== Test 2: Safetensors Parser (reference-generated) ===\n')

    const stReadBytes = async (offset, length) => stBuffer.slice(offset, offset + length)
    const stResult = await parseModelHeader(stReadBytes, stBuffer.length, 'test_model.safetensors')

    assert(stResult.file_format === 'safetensors', 'file_format is safetensors')
    assert(stResult.quantization === 'F16', `quantization is 'F16' (got '${stResult.quantization}')`)
    assert(stResult.license === 'MIT', `license is 'MIT' (got '${stResult.license}')`)
    assert(stResult.source_model_name === 'test-safetensors-model', `source_model_name is 'test-safetensors-model' (got '${stResult.source_model_name}')`)
    // parameter_count = 100*64 + 64*100 = 12800
    assert(stResult.parameter_count === 12800, `parameter_count is 12800 (got ${stResult.parameter_count})`)
    assert(Array.isArray(stResult.warnings), 'warnings is an array')

    console.log('\n=== Test 3: Unknown Format ===\n')

    const unknownPath = join(outputDir, 'test_model.onnx')
    await fs.writeFile(unknownPath, Buffer.from('not an onnx file'))

    const unknownResult = await parseModelHeader(
      async (offset, length) => Buffer.from('x'.repeat(length)),
      100,
      'test_model.onnx'
    )

    assert(unknownResult.file_format === 'onnx', 'unknown format returns format from extension')
    assert(Array.isArray(unknownResult.warnings), 'warnings is an array')

    // ── Summary ──────────────────────────────────────────

    console.log('\n' + '='.repeat(40))
    console.log(`Results: ${passCount} passed, ${failCount} failed`)
    console.log('='.repeat(40) + '\n')

    process.exit(failCount > 0 ? 1 : 0)
  } finally {
    // Cleanup
    try {
      await fs.rm(outputDir, { recursive: true, force: true })
    } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
