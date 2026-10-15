# Rule set files

## `_bmad/custom/jev-rules.generated.json` (written by `rules-build.mjs`)

Rebuilt only when the rule sources change (their hash is stored as `sourceHash`); rules whose text
did not change keep their earlier classification, so a rebuild only asks about new or edited lines.

```json
{
  "sources": ["_bmad-output/project-context.md"],
  "sourceHash": "1a2b3c4d5e6f",
  "scopeOptions": ["src/pages/**", "src/hooks/**", "**/*.tsx", "**/*.{test,spec}.*", "**"],
  "rules": [
    { "id": "r_3f9a01", "text": "Use `isFetching` for modal skeletons — NOT `isLoading` (first fetch only)",
      "heading": "Critical Implementation Rules > Framework Rules", "source": "_bmad-output/project-context.md",
      "kind": "semantic", "kindP": 0.94, "scope": ["src/pages/**"], "scopeP": 0.71 }
  ]
}
```

- `id` is a hash of the rule text: editing other lines never renumbers it; editing this line gives a new id.
- `kind`: `semantic` (the layer checks it), `mechanical` (better as a lint rule; the layer skips it),
  `not_a_rule` (skipped), `unclassified` (the provider failed; skipped).
- `scope`: globs over repo-relative paths; `**` means any file.

Do not hand-edit this file: the next rebuild replaces it.

## `_bmad/custom/jev-rules.json` (yours, never overwritten)

```json
{
  "rules": {
    "r_3f9a01": { "scope": ["src/pages/**/*Modal*.tsx", "src/components/**/*Modal*.tsx"] },
    "r_77c1aa": { "kind": "semantic" },
    "r_0d9e42": { "disabled": true }
  },
  "extra": [
    { "text": "Mutations must invalidate list, pending and detail query keys of their domain", "scope": ["src/**/*.ts", "src/**/*.tsx"] }
  ]
}
```

- Keys under `rules` are ids from the generated file; given fields replace the generated ones.
- `extra` adds rules that are not in the agent instructions (kind defaults to `semantic`).
- Commit it with the project, so the whole team gets the same corrections.
