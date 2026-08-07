"""Entry point: python -m arsvox_agent [--config path] [--host h] [--port p] [--mock]"""

import argparse
from pathlib import Path

import uvicorn

from arsvox_agent.app import create_app
from arsvox_agent.config_loader import load_config
from scripts._harness import dump_mock_config


def main() -> None:
    parser = argparse.ArgumentParser(prog="arsvox-agent")
    parser.add_argument("--config", default="configs/app.yaml", help="path to config yaml")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--mock", action="store_true", help="force scripted model")
    args = parser.parse_args()

    config, _ = load_config(Path(args.config))
    host = args.host or config.server.host
    port = args.port or config.server.port
    if args.mock:
        # Never rewrite the user's config file: write the mock variant to
        # a temp file and boot from that.
        args.config = dump_mock_config(args.config, mock=True)[0]
    app = create_app(args.config)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
