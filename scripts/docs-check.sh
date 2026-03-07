#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import re
import sys

files = [Path('README.md')] + sorted(Path('docs').rglob('*.md'))
heading_re = re.compile(r'^(#{1,6})\s+.+$')
link_re = re.compile(r'!\[[^\]]*\]\(([^)]+)\)|\[[^\]]+\]\(([^)]+)\)')

errors = []

for file_path in files:
    text = file_path.read_text(encoding='utf-8')
    lines = text.splitlines()

    in_code_block = False
    prev_heading_level = 0
    h1_count = 0

    for lineno, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        hm = heading_re.match(line)
        if hm:
            level = len(hm.group(1))
            if level == 1:
                h1_count += 1
            if prev_heading_level and level > prev_heading_level + 1:
                errors.append(
                    f"{file_path}:{lineno}: heading level jump H{prev_heading_level} -> H{level}"
                )
            prev_heading_level = level

        for lm in link_re.finditer(line):
            link = lm.group(1) or lm.group(2)
            if not link:
                continue
            if link.startswith('#') or '://' in link or link.startswith('mailto:'):
                continue

            link_path = link.split('#', 1)[0].split('?', 1)[0].strip()
            if not link_path:
                continue

            target = (file_path.parent / link_path).resolve() if not link_path.startswith('/') else Path(link_path)
            if not target.exists():
                errors.append(f"{file_path}:{lineno}: broken local link -> {link}")

    if h1_count == 0:
        errors.append(f"{file_path}: missing H1 heading")
    elif h1_count > 1:
        errors.append(f"{file_path}: multiple H1 headings ({h1_count})")

if errors:
    print('docs-check failed:')
    for err in errors:
        print(f'- {err}')
    sys.exit(1)

print(f'docs-check passed: {len(files)} markdown files checked.')
PY
