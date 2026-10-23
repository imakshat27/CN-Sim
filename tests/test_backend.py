import json
import struct
import tempfile
import unittest
from pathlib import Path

from backend.analysis import aggregate, summarize
from backend.capture import read_capture
from backend.models import ExperimentRequest, Topology


class Models(unittest.TestCase):
    def setUp(self):
        self.top = json.loads(Path("/app/dist/examples/redundant.json").read_text())

    def test_valid_topology(self):
        self.assertEqual(len(Topology(**self.top).nodes), 8)

    def test_reject_duplicate_link(self):
        self.top["links"].append(self.top["links"][0])
        with self.assertRaises(ValueError):
            Topology(**self.top)

    def test_reject_host_transit(self):
        self.top["links"].append(dict(id="bad", a="PC1", b="R3"))
        with self.assertRaises(ValueError):
            Topology(**self.top)

    def test_reject_command_in_id(self):
        self.top["nodes"][0]["id"] = "PC;id"
        with self.assertRaises(ValueError):
            Topology(**self.top)

    def test_reject_failure_after_end(self):
        with self.assertRaises(ValueError):
            ExperimentRequest(
                topology=self.top,
                source="PC1",
                target="PC2",
                duration=5,
                failure_link="L3",
                failure_at=5,
            )


class Measurements(unittest.TestCase):
    def test_actual_delivery_and_shared_clock_latency(self):
        sent = [
            {"id": 1, "sent_ns": 1000000000, "bytes": 512},
            {"id": 2, "sent_ns": 2000000000, "bytes": 512},
            {"ack": 1, "rtt_ms": 22},
        ]
        received = [
            {"id": 1, "received_ns": 1010000000},
            {"id": 1, "received_ns": 1010000000},
        ]
        cap = [dict(protocol="OSPF", epoch=100.5, bytes=64)]
        m, ps, bins, control = summarize(
            sent, received, cap, 2, 100, 1000000000, 1, 512, None, [], 1, True
        )
        self.assertEqual(m["sent"], 2)
        self.assertEqual(m["delivered"], 1)
        self.assertEqual(m["loss"], 50)
        self.assertEqual(m["meanDelay"], 10)
        self.assertEqual(m["controlBytes"], 64)
        self.assertEqual(m["throughput"], 0.002048)
        self.assertIsNone(m["recovery"])

    def test_unrecovered_stays_null(self):
        samples = [
            dict(time=i, signature=str(i), complete=False, changed=True)
            for i in range(5)
        ]
        m, *_ = summarize([], [], [], 5, 100, 0, 10, 512, 1, samples, 0, True)
        self.assertIsNone(m["routeConvergence"])
        self.assertIsNone(m["recovery"])
        self.assertIsNone(m["meanDelay"])

    def test_failed_trials_excluded(self):
        self.assertEqual(aggregate([dict(protocol="OSPF", status="cancelled")]), [])

    def test_cooked_v2_pcap_control_decode(self):
        ip = bytes.fromhex("4500004000000000405900000a000001e0000005") + bytes(44)
        cooked = struct.pack("!HHIHBB8s", 0x0800, 0, 7, 1, 4, 6, bytes(8))
        payload = cooked + ip
        content = (
            struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 276)
            + struct.pack("<IIII", 100, 500000, len(payload), len(payload))
            + payload
        )
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "test.pcap"
            p.write_bytes(content)
            r = read_capture(p, "R1", {7: "a1"})
        self.assertEqual(r[0]["protocol"], "OSPF")
        self.assertEqual(r[0]["bytes"], 64)
        self.assertEqual(r[0]["interface"], "a1")
        self.assertEqual(r[0]["epoch"], 100.5)


class RecoveryWindows(unittest.TestCase):
    def test_one_packet_per_second_can_recover(self):
        sent = [
            {"id": i + 1, "sent_ns": i * 1_000_000_000, "bytes": 128} for i in range(5)
        ]
        received = [
            {"id": i + 1, "received_ns": i * 1_000_000_000 + 10_000_000}
            for i in range(5)
        ]
        metrics, *_ = summarize(sent, received, [], 5, 100, 0, 1, 128, 1.5, [], 0, True)
        self.assertEqual(metrics["recovery"], 0.5)

    def test_stability_window_is_required(self):
        samples = [
            {"time": 1, "signature": "a", "complete": True, "changed": True},
            {"time": 2, "signature": "b", "complete": True, "changed": True},
            {"time": 2.5, "signature": "b", "complete": True, "changed": False},
        ]
        metrics, *_ = summarize([], [], [], 3, 100, 0, 1, 128, 1, samples, 0, True)
        self.assertIsNone(metrics["routeConvergence"])


if __name__ == "__main__":
    unittest.main()
