default:
    @just --list

# Run all tests, or pass a test file/filter after the recipe name.
test *args:
    bun test {{ args }}

# Run the repository linter.
lint:
    bun run lint

# Build and install the current platform's release binary into Bun's global bin directory.
install:
    #!/usr/bin/env bash
    set -euo pipefail
    target="$(bun -e 'process.stdout.write("bun-" + process.platform + "-" + process.arch)')"
    bin_dir="$(bun pm bin -g)"
    case ":$PATH:" in
      *":$bin_dir:"*) ;;
      *) echo "Bun global bin directory is not on PATH: $bin_dir" >&2; exit 1 ;;
    esac
    bun run release -- --target "$target"
    mkdir -p "$bin_dir"
    ln -sfn "{{ justfile_directory() }}/dist/release/$target/acs" "$bin_dir/acs"
    "$bin_dir/acs" init
    "$bin_dir/acs" --help >/dev/null
    echo "Installed acs -> $bin_dir/acs"
