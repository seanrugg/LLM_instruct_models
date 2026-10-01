/**
 * Pure ESM module for parsing model file headers.
 * Supports: GGUF (v2/v3), safetensors, onnx, pt, pth, tar, zip, gz, bin.
 * Never throws on malformed files — returns what was parsed plus warnings.
 * Maximum 64 MB of header read.
 */

const MAX_HEADER_BYTES = 64 * 1024 * 1024 // 64 MB

// GGUF magic bytes
const GGUF_MAGIC = new Uint8Array([0x47, 0x47, 0x55, 0x46]) // "GGUF"

// GGUF value type enum (per GGUF spec v2/v3)
const GGUF_TYPE = {
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5,
  FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9,
  UINT64: 10, INT64: 11, FLOAT64: 12,
}

// GGUF file_type mapping
const GGUF_FILE_TYPE_MAP = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0',
  9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L',
  14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K',
  19: 'IQ2_XXS',
}

function mapGgufFileType (fileType) {
  if (fileType === undefined || fileType === null) return null
  return GGUF_FILE_TYPE_MAP[fileType] || `file_type_${fileType}`
}

// Safetensors dtype mapping
const SAFETENSORS_DTYPE_MAP = {
  'F32': 'F32', 'F16': 'F16', 'BF16': 'BF16', 'I8': 'I8',
  'I16': 'I16', 'I32': 'I32', 'I64': 'I64', 'U8': 'U8',
  'U16': 'U16', 'U32': 'U32', 'U64': 'U64', 'BOOL': 'BOOL',
}

function isLargeArray (key, arrLen) {
  // Skip tokenizer vocab arrays and tensor data
  if (key.startsWith('tokenizer.') && key.endsWith('.vocab')) return true
  if (key === 'tokenizer.ggml.tokens' || key === 'tokenizer.ggml.tokens_scores') return true
  if (key.startsWith('model.layers.') && key.endsWith('.weight')) return true
  return arrLen > 10000
}

/**
 * Parse a GGUF file header.
 * @param {Function} readBytes - (offset, length) => Promise<Uint8Array>
 * @param {number} fileSize - Total file size
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} Parsed metadata
 */
export async function parseGgufHeader (readBytes, fileSize, filename) {
  const warnings = []
  let offset = 0

  try {
    // Read magic
    const magic = await readBytes(offset, 4)
    offset += 4
    if (magic[0] !== GGUF_MAGIC[0] || magic[1] !== GGUF_MAGIC[1] ||
        magic[2] !== GGUF_MAGIC[2] || magic[3] !== GGUF_MAGIC[3]) {
      return {
        file_format: 'gguf',
        architecture: null,
        parameter_count: null,
        quantization: null,
        context_length: null,
        chat_template: null,
        license: null,
        source_model_name: null,
        file_metadata: {},
        warnings: ['Invalid GGUF magic bytes'],
      }
    }

    // Read version
    const versionBuf = await readBytes(offset, 4)
    offset += 4
    const version = new DataView(versionBuf.buffer, versionBuf.byteOffset, versionBuf.byteLength).getUint32(0, true)
    if (version !== 2 && version !== 3) {
      warnings.push(`Unsupported GGUF version: ${version}`)
    }

    // Read tensor_count and kv_count (uint64)
    const tensorCountBuf = await readBytes(offset, 8)
    offset += 8
    const tensorCount = Number(new DataView(tensorCountBuf.buffer, tensorCountBuf.byteOffset, tensorCountBuf.byteLength).getBigInt64(0, true))

    const kvCountBuf = await readBytes(offset, 8)
    offset += 8
    const kvCount = Number(new DataView(kvCountBuf.buffer, kvCountBuf.byteOffset, kvCountBuf.byteLength).getBigInt64(0, true))

    // Read KV pairs
    const kvPairs = {}
    for (let i = 0; i < kvCount && offset < MAX_HEADER_BYTES; i++) {
      // Read key length
      const keyLenBuf = await readBytes(offset, 4)
      offset += 4
      const keyLen = new DataView(keyLenBuf.buffer, keyLenBuf.byteOffset, keyLenBuf.byteLength).getUint32(0, true)

      // Read key
      const keyBuf = await readBytes(offset, keyLen)
      offset += keyLen
      const key = new TextDecoder().decode(keyBuf)

      // Read value type
      const typeBuf = await readBytes(offset, 4)
      offset += 4
      const valueType = new DataView(typeBuf.buffer, typeBuf.byteOffset, typeBuf.byteLength).getUint32(0, true)

      // Read value based on type
      let value = null
      switch (valueType) {
        case GGUF_TYPE.UINT32: {
          const buf = await readBytes(offset, 4)
          offset += 4
          value = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true)
          break
        }
        case GGUF_TYPE.INT32: {
          const buf = await readBytes(offset, 4)
          offset += 4
          value = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getInt32(0, true)
          break
        }
        case GGUF_TYPE.FLOAT32: {
          const buf = await readBytes(offset, 4)
          offset += 4
          value = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getFloat32(0, true)
          break
        }
        case GGUF_TYPE.STRING: {
          const strLenBuf = await readBytes(offset, 4)
          offset += 4
          const strLen = new DataView(strLenBuf.buffer, strLenBuf.byteOffset, strLenBuf.byteLength).getUint32(0, true)
          const strBuf = await readBytes(offset, strLen)
          offset += strLen
          value = new TextDecoder().decode(strBuf)
          break
        }
        case GGUF_TYPE.ARRAY: {
          const arrTypeBuf = await readBytes(offset, 4)
          offset += 4
          const arrType = new DataView(arrTypeBuf.buffer, arrTypeBuf.byteOffset, arrTypeBuf.byteLength).getUint32(0, true)
          const arrLenBuf = await readBytes(offset, 8)
          offset += 8
          const arrLen = Number(new DataView(arrLenBuf.buffer, arrLenBuf.byteOffset, arrLenBuf.byteLength).getBigInt64(0, true))

          // Skip large arrays
          if (isLargeArray(key, arrLen)) {
            let skipBytes = 0
            for (let j = 0; j < arrLen; j++) {
              switch (arrType) {
                case GGUF_TYPE.UINT32: skipBytes += 4; break
                case GGUF_TYPE.INT32: skipBytes += 4; break
                case GGUF_TYPE.FLOAT32: skipBytes += 4; break
                case GGUF_TYPE.STRING: {
                  const slBuf = await readBytes(offset + skipBytes, 4)
                  const sl = new DataView(slBuf.buffer, slBuf.byteOffset, slBuf.byteLength).getUint32(0, true)
                  skipBytes += 4 + sl
                  break
                }
                default: skipBytes += 8 // assume 8 bytes per element
              }
            }
            await readBytes(offset, skipBytes)
            offset += skipBytes
            value = null // skipped
          } else {
            // Read small array (simplified)
            value = []
            for (let j = 0; j < arrLen; j++) {
              switch (arrType) {
                case GGUF_TYPE.UINT32: {
                  const buf = await readBytes(offset, 4)
                  offset += 4
                  value.push(new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true))
                  break
                }
                case GGUF_TYPE.STRING: {
                  const slBuf = await readBytes(offset, 4)
                  offset += 4
                  const sl = new DataView(slBuf.buffer, slBuf.byteOffset, slBuf.byteLength).getUint32(0, true)
                  const strBuf = await readBytes(offset, sl)
                  offset += sl
                  value.push(new TextDecoder().decode(strBuf))
                  break
                }
                default:
                  await readBytes(offset, 8)
                  offset += 8
                  value.push(null)
              }
            }
          }
          break
        }
        case GGUF_TYPE.BOOL: {
          const buf = await readBytes(offset, 1)
          offset += 1
          value = buf[0] !== 0
          break
        }
        default:
          // Skip unknown types (assume 8 bytes)
          await readBytes(offset, 8)
          offset += 8
          value = null
      }

      kvPairs[key] = value
    }

    // Extract metadata
    const general = kvPairs['general.architecture'] || ''
    const name = kvPairs['general.name'] || ''
    const license = kvPairs['general.license'] || null
    const fileType = kvPairs['general.file_type']
    const contextLength = kvPairs[`${general}.context_length`] || null
    const parameterCount = kvPairs['general.parameter_count'] || null
    const chatTemplate = kvPairs['tokenizer.chat_template'] || null

    // Quantization from file_type
    const quantization = mapGgufFileType(fileType)

    return {
      file_format: 'gguf',
      architecture: general || null,
      parameter_count: parameterCount,
      quantization,
      context_length: contextLength,
      chat_template: chatTemplate,
      license,
      source_model_name: name || null,
      file_metadata: {
        ...kvPairs,
        // Remove large arrays from metadata
        tokenizer: undefined,
        model: undefined,
      },
      warnings,
    }
  } catch (err) {
    warnings.push(`GGUF parse error: ${err.message}`)
    return {
      file_format: 'gguf',
      architecture: null,
      parameter_count: null,
      quantization: null,
      context_length: null,
      chat_template: null,
      license: null,
      source_model_name: null,
      file_metadata: {},
      warnings,
    }
  }
}

/**
 * Parse a safetensors file header.
 * @param {Function} readBytes - (offset, length) => Promise<Uint8Array>
 * @param {number} fileSize - Total file size
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} Parsed metadata
 */
export async function parseSafetensorsHeader (readBytes, fileSize, filename) {
  const warnings = []

  try {
    // Read header length (8 bytes, LE uint64)
    const lenBuf = await readBytes(0, 8)
    const headerLen = Number(new DataView(lenBuf.buffer, lenBuf.byteOffset, lenBuf.byteLength).getBigInt64(0, true))

    if (headerLen > 100 * 1024 * 1024) {
      // Reject if header > 100 MB
      return {
        file_format: 'safetensors',
        architecture: null,
        parameter_count: null,
        quantization: null,
        context_length: null,
        chat_template: null,
        license: null,
        source_model_name: null,
        file_metadata: {},
        warnings: [`Header length ${headerLen} exceeds 100 MB limit`],
      }
    }

    // Read header JSON
    const headerBuf = await readBytes(8, headerLen)
    const headerStr = new TextDecoder().decode(headerBuf)
    const header = JSON.parse(headerStr)

    // Calculate parameter count from tensor shapes
    // In safetensors format, tensor names are top-level keys (not under __tensors)
    let parameterCount = 0
    const dtypeCounts = {}
    let tensorCount = 0

    for (const [key, value] of Object.entries(header)) {
      if (key.startsWith('__')) continue // skip __metadata__ and other special keys
      if (value && typeof value === 'object' && value.shape) {
        tensorCount++
        let prod = 1
        for (const dim of value.shape) {
          prod *= dim
        }
        parameterCount += prod

        if (value.dtype) {
          const dtype = SAFETENSORS_DTYPE_MAP[value.dtype] || value.dtype
          dtypeCounts[dtype] = (dtypeCounts[dtype] || 0) + 1
        }
      }
    }
    const dominantDtype = Object.entries(dtypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

    // Extract __metadata__
    const metadata = header['__metadata__'] || {}
    const license = metadata.license || null
    const name = metadata.name || null

    return {
      file_format: 'safetensors',
      architecture: null,
      parameter_count: parameterCount,
      quantization: dominantDtype,
      context_length: null,
      chat_template: null,
      license,
      source_model_name: name,
      file_metadata: {
        ...metadata,
        // Include tensor count but not individual tensor data
        tensor_count: tensorCount,
      },
      warnings,
    }
  } catch (err) {
    warnings.push(`Safetensors parse error: ${err.message}`)
    return {
      file_format: 'safetensors',
      architecture: null,
      parameter_count: null,
      quantization: null,
      context_length: null,
      chat_template: null,
      license: null,
      source_model_name: null,
      file_metadata: {},
      warnings,
    }
  }
}

/**
 * Parse a model file header.
 * @param {Function} readBytes - (offset, length) => Promise<Uint8Array>
 * @param {number} fileSize - Total file size
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} Parsed metadata
 */
export async function parseModelHeader (readBytes, fileSize, filename) {
  const warnings = []

  try {
    // Read first 4 bytes to detect format
    const header = await readBytes(0, 4)

    // Check for GGUF magic
    if (header[0] === GGUF_MAGIC[0] && header[1] === GGUF_MAGIC[1] &&
        header[2] === GGUF_MAGIC[2] && header[3] === GGUF_MAGIC[3]) {
      return await parseGgufHeader(readBytes, fileSize, filename)
    }

    // Check for safetensors: try reading 8-byte length prefix first
    // Real safetensors files have an 8-byte LE uint64 length prefix before the JSON
    try {
      const lenBuf = await readBytes(0, 8)
      const len = Number(new DataView(lenBuf.buffer, lenBuf.byteOffset, lenBuf.byteLength).getBigInt64(0, true))
      if (len > 0 && len < fileSize && len < 100 * 1024 * 1024) {
        // Verify the next bytes look like JSON (start with '{' or '[')
        const jsonStart = await readBytes(8, 1)
        if (jsonStart[0] === 0x7B || jsonStart[0] === 0x5B) {
          return await parseSafetensorsHeader(readBytes, fileSize, filename)
        }
      }
    } catch (_) { /* not safetensors */ }

    // Unknown format — return minimal info
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    const formatMap = {
      '.onnx': 'onnx', '.pt': 'pytorch', '.pth': 'pytorch',
      '.tar': 'archive', '.zip': 'archive', '.gz': 'archive', '.bin': 'bin',
    }
    const fileFormat = formatMap[ext] || 'unknown'

    return {
      file_format: fileFormat,
      architecture: null,
      parameter_count: null,
      quantization: null,
      context_length: null,
      chat_template: null,
      license: null,
      source_model_name: null,
      file_metadata: {},
      warnings: [`Unsupported file format: ${ext}`],
    }
  } catch (err) {
    warnings.push(`Parse error: ${err.message}`)
    return {
      file_format: 'unknown',
      architecture: null,
      parameter_count: null,
      quantization: null,
      context_length: null,
      chat_template: null,
      license: null,
      source_model_name: null,
      file_metadata: {},
      warnings,
    }
  }
}
