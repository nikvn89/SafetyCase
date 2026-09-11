from __future__ import annotations

import hashlib
import json
import re
import sys
import types
from pathlib import Path


ZERO = "0x0000000000000000000000000000000000000000"
OWNER = "0x1111111111111111111111111111111111111111"
REVIEWER = "0x2222222222222222222222222222222222222222"
OUTSIDER = "0x3333333333333333333333333333333333333333"


class U256(int):
    def __new__(cls, value=0):
        value = int(value)
        if value < 0:
            raise ValueError("u256 cannot be negative")
        return int.__new__(cls, value)


class Address(str):
    def __new__(cls, value):
        if isinstance(value, Address):
            return value
        if not isinstance(value, str):
            raise ValueError("address must be string")
        v = value.strip()
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", v):
            raise ValueError("invalid address")
        return str.__new__(cls, "0x" + v[2:].lower())


class TreeMap(dict):
    @classmethod
    def __class_getitem__(cls, _item):
        return cls


class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class Keccak256:
    """Test-only deterministic hash wrapper; exact hash algorithm is irrelevant to state probes."""
    def __init__(self, data: bytes):
        self._data = data

    def hexdigest(self):
        return hashlib.sha256(self._data).hexdigest()


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _Message:
    sender_address = Address(OWNER)


class _VM:
    UserError = UserError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(evaluate_once, _validator_fn):
        return Return(evaluate_once())


class _Nondet:
    @staticmethod
    def exec_prompt(*_args, **_kwargs):
        raise RuntimeError("exec_prompt should be patched out in deterministic tests")


class _Contract:
    pass


class _GL:
    Contract = _Contract
    public = _Public()
    message = _Message()
    vm = _VM()
    nondet = _Nondet()


def allow_storage(cls):
    return cls


def install_fake_genlayer():
    m = types.ModuleType("genlayer")
    m.gl = _GL()
    m.u256 = U256
    m.Address = Address
    m.TreeMap = TreeMap
    m.Keccak256 = Keccak256
    m.allow_storage = allow_storage
    sys.modules["genlayer"] = m
    return m


def load_contract(source_path: Path | None = None, source_text: str | None = None):
    fake = install_fake_genlayer()
    if source_text is None:
        if source_path is None:
            source_path = Path(__file__).resolve().parents[1] / "contracts" / "SafetyCase.py"
        source_text = source_path.read_text(encoding="utf-8")
    mod = types.ModuleType("safetycase_under_test")
    mod.__file__ = str(source_path or "<mutant>")
    sys.modules[mod.__name__] = mod
    exec(compile(source_text, mod.__file__, "exec"), mod.__dict__)
    return mod, fake.gl


def new_contract(mod, gl):
    c = mod.SafetyCaseGate()
    for name in (
        "systems",
        "hazards",
        "mitigations",
        "system_mitigation_index",
        "hazard_attempt_index",
        "attempt_lookup",
        "evidence_lookup",
        "challenges",
        "system_challenge_index",
    ):
        setattr(c, name, {})
    gl.message.sender_address = Address(OWNER)
    return c


def set_sender(gl, address: str):
    gl.message.sender_address = Address(address)


def digest(n: int) -> str:
    return f"{n:064x}"


def create_basic_system(c, gl, reviewer: str = REVIEWER):
    set_sender(gl, OWNER)
    c.create_system(
        "Warehouse safety release gate.",
        json.dumps([
            "A warehouse conveyor can restart while the physical guard door is open.",
            "A pallet with an out-of-tolerance component can leave the dispatch bay.",
        ]),
        reviewer,
    )
    return 1


def patch_classifier(c, verdicts):
    queue = list(verdicts)
    calls = {"count": 0}

    def classifier(_hazard, _mitigation):
        calls["count"] += 1
        if not queue:
            raise AssertionError("classifier called more times than expected")
        return queue.pop(0)

    c._classify_mitigation = classifier
    return calls


def expect_user_error(fn, contains: str | None = None):
    try:
        fn()
    except UserError as exc:
        if contains is not None and contains not in str(exc):
            raise AssertionError(f"Expected error containing {contains!r}, got {exc!r}")
        return str(exc)
    raise AssertionError("Expected UserError, call succeeded")
