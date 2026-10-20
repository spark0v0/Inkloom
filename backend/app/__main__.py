import argparse
from pathlib import Path

import uvicorn

from .main import create_app


def main():
    parser = argparse.ArgumentParser(description="叙事工坊本地工作区")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    uvicorn.run(create_app(args.data_dir, port=args.port), host="127.0.0.1", port=args.port,
                log_level="info", access_log=False)


if __name__ == "__main__":
    main()
