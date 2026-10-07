#!/usr/bin/env python3
"""
Generate test fixtures for modelHeader.mjs parser tests.
Uses reference writers (gguf, safetensors Python packages) to ensure
fixtures are valid per the real format specs.

Writer sequence:
    GGUFWriter(path, arch) → add_* calls → write_header_to_file() →
    write_kv_data_to_file() → write_tensors_to_file() → close()

Usage:
    python scripts/generate_test_fixtures.py [--output-dir /tmp]

Requires (in project venv):
    .venv-test/bin/pip install gguf safetensors numpy
"""

import argparse
import os
import sys


def generate_gguf(output_path: str) -> None:
    """Generate a small valid GGUF v3 file using gguf.GGUFWriter."""
    try:
        import gguf
        import numpy as np
    except ImportError:
        print("ERROR: gguf/numpy packages not installed.", file=sys.stderr)
        print("Run: .venv-test/bin/pip install gguf safetensors numpy", file=sys.stderr)
        sys.exit(1)

    # arch argument sets general.architecture automatically
    writer = gguf.GGUFWriter(output_path, "llama")

    # general.name, general.license, general.file_type
    writer.add_key_value("general.name", "Llama-3-8B-Instruct", gguf.GGUFValueType.STRING)
    writer.add_key_value("general.license", "custom", gguf.GGUFValueType.STRING)
    writer.add_key_value("general.file_type", 15, gguf.GGUFValueType.UINT32)  # Q4_K_M

    # llama.context_length, llama.vocab_size
    writer.add_key_value("llama.context_length", 8192, gguf.GGUFValueType.UINT32)
    writer.add_key_value("llama.vocab_size", 128000, gguf.GGUFValueType.UINT32)

    # tokenizer.chat_template (STRING)
    writer.add_key_value(
        "tokenizer.chat_template",
        '{% for message in messages %}{{ message["content"] }}{% endfor %}',
        gguf.GGUFValueType.STRING,
    )

    # tokenizer.ggml.tokens (ARRAY of STRING)
    tokens = ["<pad>", "<bos>", "<eos>", "hello", "world"]
    writer.add_key_value("tokenizer.ggml.tokens", tokens, gguf.GGUFValueType.ARRAY)

    # tokenizer.ggml.scores (ARRAY of FLOAT32)
    scores = [0.1, 0.2, 0.3, 0.4, 0.5]
    writer.add_key_value("tokenizer.ggml.scores", scores, gguf.GGUFValueType.ARRAY)

    # tokenizer.ggml.token_type (ARRAY of INT32)
    token_types = [1, 2, 3, 1, 2]
    writer.add_key_value("tokenizer.ggml.token_type", token_types, gguf.GGUFValueType.ARRAY)

    # BOOL key
    writer.add_key_value("general.bos_token_id", True, gguf.GGUFValueType.BOOL)

    # UINT64 key
    writer.add_key_value("general.eos_token_id", 128001, gguf.GGUFValueType.UINT64)

    # Add general.parameter_count (gguf library does not auto-add it)
    # parameter_count = 32*16 + 16*16 = 512 + 256 = 768
    writer.add_key_value("general.parameter_count", 768, gguf.GGUFValueType.UINT64)

    # Add 2 small tensors (tiny for fixture size)
    writer.add_tensor("model.embed_tokens.weight", np.zeros((32, 16), dtype=np.float16))
    writer.add_tensor("model.layers.0.self_attn.q_proj.weight", np.zeros((16, 16), dtype=np.float16))

    # Write in correct sequence
    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    print(f"Generated GGUF: {output_path}")


def generate_safetensors(output_path: str) -> None:
    """Generate a small valid safetensors file using safetensors.numpy."""
    try:
        from safetensors.numpy import save_file
        import numpy as np
    except ImportError:
        print("ERROR: safetensors/numpy packages not installed.", file=sys.stderr)
        print("Run: .venv-test/bin/pip install gguf safetensors numpy", file=sys.stderr)
        sys.exit(1)

    tensors = {
        "embedding.weight": np.zeros((100, 64), dtype=np.float16),
        "output.weight": np.zeros((64, 100), dtype=np.float16),
    }

    metadata = {
        "license": "MIT",
        "name": "test-safetensors-model",
    }

    save_file(tensors, output_path, metadata=metadata)
    print(f"Generated safetensors: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate test fixtures")
    parser.add_argument("--output-dir", default="/tmp", help="Output directory (default: /tmp)")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    gguf_path = os.path.join(args.output_dir, "test_model.gguf")
    st_path = os.path.join(args.output_dir, "test_model.safetensors")

    generate_gguf(gguf_path)
    generate_safetensors(st_path)

    # Print expected parser output
    print("\nExpected parser results:")
    print(f"  GGUF:")
    print(f"    file_format: gguf")
    print(f"    architecture: llama")
    print(f"    quantization: Q4_K_M")
    print(f"    context_length: 8192")
    print(f"    license: custom")
    print(f"    source_model_name: Llama-3-8B-Instruct")
    print(f"    parameter_count: 768")

    print(f"  Safetensors:")
    print(f"    file_format: safetensors")
    print(f"    quantization: F16")
    print(f"    license: MIT")
    print(f"    source_model_name: test-safetensors-model")
    print(f"    parameter_count: 12800")


if __name__ == "__main__":
    main()
