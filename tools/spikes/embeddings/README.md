# M0-05 embedding bake-off

Picks the embedding model used to retrieve example messages for a conversation context
(ADR-09, system design 9.3) for code-mixed Roman Urdu/Hindi + English.

Data: `data/eval/embeddings/pairs.yaml` (50 items: 20 `pk-`, 20 `in-`, 10 `en-`). Each has a query,
one positive and 3 hard negatives. The corpus is every positive + negative (deduped); each query ranks
the whole corpus by cosine similarity. Spellings intentionally differ between query and positive.

## Run (from repo root)

```
uv run --project services/api python tools/spikes/embeddings/run.py --provider fake
uv run --project services/api python tools/spikes/embeddings/run.py --provider fake --normalize-spelling
uv run --with pyyaml --with sentence-transformers python tools/spikes/embeddings/run.py --provider bge-m3
OPENAI_API_KEY=... uv run --with pyyaml --with openai python tools/spikes/embeddings/run.py --provider openai [--model text-embedding-3-large]
VOYAGE_API_KEY=... uv run --with pyyaml --with voyageai python tools/spikes/embeddings/run.py --provider voyage [--model voyage-3]
```

Plain `python3` works for `fake` if pyyaml is installed. Add `--normalize-spelling` to any run to
canonicalize spelling variants (kia->kya, hy->hai, ni/nai/nhi->nahi, yr->yaar, ...) first.
Results print as Markdown and append to `out/results.md`.

## Metrics

- Recall@1 / Recall@5: share of queries whose positive ranks in the top 1 / 5 of the corpus.
- MRR: mean of 1/rank of the positive (rewards ranking it higher).
- Reported overall and per group (pk / in / en, from id prefix).
- Latency: average seconds per embedding batch (size 32), including network for API providers.

`fake` is a lexical character-trigram baseline: a real model must clearly beat it, otherwise
semantic embeddings add nothing here.

## Decision rule

Pick the model with the best Recall@5 on the pk+in groups (the script prints it). If models are
within about 0.02, tie-break by cost, then latency, then self-hostability (bge-m3 runs locally, which
fits local-first). Run each model with and without `--normalize-spelling`; adopt canonicalization
only if it improves pk+in Recall@5 for the chosen model.
