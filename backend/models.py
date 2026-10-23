"""Validated, bounded API inputs. No user-provided shell commands are accepted."""

from typing import Literal, Optional
from pydantic import BaseModel, Field, conlist, constr, root_validator

Identifier = constr(regex=r"^[A-Za-z][A-Za-z0-9_-]{0,15}$")


class Node(BaseModel):
    id: Identifier
    type: Literal["router", "host"]
    x: float = Field(ge=30, le=1170)
    y: float = Field(ge=30, le=670)


class Link(BaseModel):
    id: Identifier
    a: Identifier
    b: Identifier
    bandwidth: float = Field(default=100, ge=0.1, le=1000)
    delay: float = Field(default=2, ge=0, le=100)
    loss: float = Field(default=0, ge=0, le=20)
    up: bool = True


class Topology(BaseModel):
    nodes: conlist(Node, min_items=2, max_items=20)
    links: conlist(Link, min_items=1, max_items=40)

    @root_validator
    def check_graph(cls, v):
        ns = v.get("nodes", [])
        ls = v.get("links", [])
        ids = {n.id for n in ns}
        if len(ids) != len(ns):
            raise ValueError("Device IDs must be unique")
        if not any(n.type == "router" for n in ns):
            raise ValueError("Add at least one router")
        pairs = set()
        lids = set()
        for l in ls:
            pair = tuple(sorted((l.a, l.b)))
            if (
                l.a not in ids
                or l.b not in ids
                or l.a == l.b
                or pair in pairs
                or l.id in lids
            ):
                raise ValueError("Invalid or duplicate connection")
            pairs.add(pair)
            lids.add(l.id)
        for n in ns:
            if n.type == "host":
                links = [l for l in ls if n.id in (l.a, l.b)]
                if len(links) != 1:
                    raise ValueError(
                        f"{n.id}: each end host needs exactly one router connection"
                    )
                peer = next(
                    x
                    for x in ns
                    if x.id == (links[0].b if links[0].a == n.id else links[0].a)
                )
                if peer.type != "router":
                    raise ValueError("Connect end hosts to routers")
        return v


class DeployRequest(BaseModel):
    topology: Topology
    protocol: Literal["RIP", "OSPF", "EIGRP"] = "OSPF"
    timer_profile: Literal["standard", "lab"] = "lab"


class ExperimentRequest(DeployRequest):
    protocols: conlist(Literal["RIP", "OSPF", "EIGRP"], min_items=1, max_items=3) = [
        "RIP",
        "OSPF",
        "EIGRP",
    ]
    source: Identifier
    target: Identifier
    duration: int = Field(default=25, ge=5, le=120)
    rate: int = Field(default=20, ge=1, le=100)
    size: int = Field(default=512, ge=64, le=1400)
    trials: int = Field(default=1, ge=1, le=5)
    failure_link: Optional[Identifier] = None
    failure_at: float = Field(default=10, ge=1, le=119)

    @root_validator
    def endpoints(cls, v):
        t = v.get("topology")
        if not t:
            return v
        ids = {n.id for n in t.nodes}
        if (
            v.get("source") not in ids
            or v.get("target") not in ids
            or v.get("source") == v.get("target")
        ):
            raise ValueError("Select two different devices in the topology")
        if len(set(v.get("protocols", []))) != len(v.get("protocols", [])):
            raise ValueError("Protocols must be unique")
        if v.get("failure_link"):
            link = next((l for l in t.links if l.id == v["failure_link"]), None)
            if not link or not link.up:
                raise ValueError("Choose an active failure link")
            if v.get("failure_at", 0) >= v.get("duration", 0) - 1:
                raise ValueError("Failure must leave at least one second for recovery")
        return v


class ProbeRequest(BaseModel):
    source: Identifier
    target: Identifier
    kind: Literal["ping", "trace"] = "ping"


class LinkRequest(BaseModel):
    up: bool
