"""Paced real UDP probes. Namespace processes share the same Linux monotonic clock."""

import argparse, json, socket, struct, time, select

HEADER = struct.Struct("!4sIQ")
p = argparse.ArgumentParser()
p.add_argument("mode", choices=["rx", "tx"])
p.add_argument("--target")
p.add_argument("--source")
p.add_argument("--duration", type=float, default=20)
p.add_argument("--rate", type=int, default=20)
p.add_argument("--size", type=int, default=512)
a = p.parse_args()
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
if a.mode == "rx":
    s.bind(("0.0.0.0", 49000))
    s.settimeout(0.5)
    print(json.dumps({"ready": True}), flush=True)
    while True:
        try:
            data, peer = s.recvfrom(65535)
            received = time.monotonic_ns()
            if len(data) < HEADER.size:
                continue
            magic, seq, sent = HEADER.unpack_from(data)
            if magic != b"CNSM":
                continue
            print(
                json.dumps(
                    {
                        "id": seq,
                        "sent_ns": sent,
                        "received_ns": received,
                        "bytes": len(data),
                    }
                ),
                flush=True,
            )
            try:
                s.sendto(data, peer)
            except OSError:
                pass
        except OSError:
            continue
else:
    s.bind((a.source, 0))
    s.setblocking(False)
    start = time.monotonic()
    end = start + a.duration
    seq = 0
    total = int(a.duration * a.rate)
    while time.monotonic() < end + 2:
        now = time.monotonic()
        if seq < total and now >= start + seq / a.rate:
            sent = time.monotonic_ns()
            data = HEADER.pack(b"CNSM", seq + 1, sent) + bytes(a.size - HEADER.size)
            try:
                s.sendto(data, (a.target, 49000))
                error = None
            except OSError as e:
                error = str(e)
            print(
                json.dumps(
                    {"id": seq + 1, "sent_ns": sent, "bytes": len(data), "error": error}
                ),
                flush=True,
            )
            seq += 1
        try:
            while True:
                data, peer = s.recvfrom(65535)
                received = time.monotonic_ns()
                if len(data) >= HEADER.size:
                    magic, n, sent = HEADER.unpack_from(data)
                    if magic == b"CNSM":
                        print(
                            json.dumps({"ack": n, "rtt_ms": (received - sent) / 1e6}),
                            flush=True,
                        )
        except OSError:
            pass
        wait = (
            max(0, min(0.005, start + seq / a.rate - time.monotonic()))
            if seq < total
            else 0.005
        )
        select.select([s], [], [], wait)
