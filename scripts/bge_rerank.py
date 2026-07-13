#!/usr/bin/env python3
"""
Cross-encoder reranking using bge-reranker-v2-m3.

Reads JSON from stdin: { query, model, top_k, documents: [{id, text}] }
Writes JSON to stdout: [{ id, score, index }]

Requires:
    pip install FlagEmbedding torch
    (or) pip install sentence-transformers
"""

import json
import sys
import os


def rerank(query: str, documents: list, model_name: str, top_k: int):
    """Rerank documents against query using bge-reranker."""
    try:
        from FlagEmbedding import FlagReranker
    except ImportError:
        try:
            from sentence_transformers import CrossEncoder
        except ImportError:
            print(json.dumps({
                "error": "Neither FlagEmbedding nor sentence-transformers installed. "
                         "Run: pip install FlagEmbedding torch"
            }))
            sys.exit(1)

        # Fallback: use sentence-transformers CrossEncoder
        model = CrossEncoder(f"BAAI/{model_name}", max_length=8192)
        scores = model.predict([(query, doc["text"]) for doc in documents])

        # Sort by score descending
        indexed = list(enumerate(scores))
        indexed.sort(key=lambda x: x[1], reverse=True)

        return [
            {
                "id": documents[idx]["id"],
                "score": float(score),
                "index": idx,
            }
            for idx, score in indexed[:top_k]
        ]

    # Primary: use FlagEmbedding
    model = FlagReranker(f'BAAI/{model_name}', use_fp16=True)
    scores = model.compute_score([
        [query, doc["text"]] for doc in documents
    ], normalize=True)

    # Handle single result
    if isinstance(scores, float):
        scores = [scores]

    # Sort by score descending
    indexed = list(enumerate(scores))
    indexed.sort(key=lambda x: x[1], reverse=True)

    return [
        {
            "id": documents[idx]["id"],
            "score": float(score),
            "index": idx,
        }
        for idx, score in indexed[:top_k]
    ]


def main():
    input_data = json.load(sys.stdin)
    query = input_data["query"]
    model_name = input_data.get("model", "bge-reranker-v2-m3")
    top_k = input_data.get("top_k", 8)
    documents = input_data["documents"]

    if not documents:
        print(json.dumps([]))
        return

    results = rerank(query, documents, model_name, top_k)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
