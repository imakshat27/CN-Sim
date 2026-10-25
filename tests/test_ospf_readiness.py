import unittest
from backend.lab import Lab


class OspfReadiness(unittest.TestCase):
    def setUp(self):
        self.lab = Lab.__new__(Lab)
        self.lab.protocol = "OSPF"
        self.lab.nodes = {
            name: {"type": "router", "ip": f"10.255.0.{i}"}
            for i, name in enumerate(["A", "B", "C"], 1)
        }
        self.lab.links = {
            "AB": dict(a="A", b="B", bandwidth=100, up=True, ends={"A": "ab", "B": "ba"}),
            "BC": dict(a="B", b="C", bandwidth=50, up=True, ends={"B": "bc", "C": "cb"}),
            "AC": dict(a="A", b="C", bandwidth=10, up=True, ends={"A": "ac", "C": "ca"}),
        }
        choices = {"A": {"B": "ab", "C": "ab"}, "B": {"A": "ba", "C": "bc"}, "C": {"A": "cb", "B": "cb"}}
        self.routes = {
            source: [{"dst": self.lab.nodes[target]["ip"] + "/32", "dev": interface}
                     for target, interface in targets.items()]
            for source, targets in choices.items()
        }

    def test_complete_but_higher_cost_startup_route_is_not_ready(self):
        self.routes["A"][1]["dev"] = "ac"
        self.assertTrue(self.lab.complete(self.routes))
        self.assertFalse(self.lab.shortest_paths_ready(self.routes))
        self.routes["A"][1]["dev"] = "ab"
        self.assertTrue(self.lab.shortest_paths_ready(self.routes))

    def test_equal_cost_multipath_is_allowed_but_one_slow_next_hop_is_not(self):
        self.routes["A"][1] = {"dst": "10.255.0.3/32", "nexthops": [{"dev": "ab"}, {"dev": "ac"}]}
        self.assertFalse(self.lab.shortest_paths_ready(self.routes))
        self.lab.links["AB"]["bandwidth"] = 200
        self.lab.links["BC"]["bandwidth"] = 200
        self.lab.links["AC"]["bandwidth"] = 100
        self.assertTrue(self.lab.shortest_paths_ready(self.routes))

    def test_host_subnet_and_disconnected_components(self):
        self.lab.nodes["H"] = {"type": "host", "ip": "10.0.4.2"}
        self.lab.nodes["D"] = {"type": "router", "ip": "10.255.0.9"}
        self.lab.links["CH"] = dict(a="C", b="H", bandwidth=100, up=True, ends={"C": "ch", "H": "hc"})
        for source, dev in [("A", "ab"), ("B", "bc"), ("C", "ch")]:
            self.routes[source].append({"dst": "10.0.4.0/30", "dev": dev})
        self.assertTrue(self.lab.shortest_paths_ready(self.routes))
        self.routes["A"][-1]["dev"] = "ac"
        self.assertFalse(self.lab.shortest_paths_ready(self.routes))

    def test_other_protocols_keep_their_own_metrics(self):
        self.lab.protocol = "RIP"
        self.routes["A"][1]["dev"] = "ac"
        self.assertTrue(self.lab.shortest_paths_ready(self.routes))


if __name__ == "__main__":
    unittest.main()
