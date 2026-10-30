# Publication privacy gate

Before publication, scan only Git-tracked files for personal machine paths and private network literals:

```sh
node scripts/check-public-privacy.mjs
```

To compare exact deployment values without printing or committing them, point the script at a mode-600 JSON file containing category/value pairs:

```sh
PRIVACY_MARKERS_PATH=/secure/path/private-markers.json node scripts/check-public-privacy.mjs
```

The report contains paths and categories only. Generic synthetic examples in the PII redaction tests are allowed as test fixtures; genuine provider/model catalog support is not treated as private deployment data.
