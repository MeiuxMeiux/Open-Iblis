# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Entry point: runtime/python.exe -I -m iblis_train --port N
# (spawned by apps/shell/electron/main/sidecar/spawn.ts with cwd = the pack
# version directory and IBLIS_SESSION = the per-session shared secret).

import argparse
import sys

from .server import create_server


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="iblis_train")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)

    server = create_server(args.port)
    host, port = server.server_address[:2]
    # One startup line for the shell's per-sidecar log; never anything else
    # on stdout that could look like a protocol message.
    print(f"iblis_train listening on {host}:{port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
