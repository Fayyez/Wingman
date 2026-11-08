"""Dump the backend OpenAPI schema as stable JSON.

Run: cd services/api && uv run python ../../tools/gen_openapi.py <out.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.main import create_app
from app.settings import Settings


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: gen_openapi.py <out.json>")
    app = create_app(Settings(app_env="dev", jwt_private_key=""))
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
