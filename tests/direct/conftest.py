import os, json, hashlib, pytest
from pathlib import Path

os.environ.setdefault("GENVM_VERSION", "v0.2.12")
_default = Path(__file__).resolve().parents[2] / "contracts" / "SafetyCase.py"
CONTRACT = str(Path(os.environ.get("SAFETYCASE_CONTRACT", _default)).resolve())

SUFFICIENT = '{"verdict":"MITIGATION_SUFFICIENT"}'
GAP        = '{"verdict":"SAFETY_GAP"}'
HAZ_A = "A warehouse conveyor can restart while the physical guard door is open."
HAZ_B = "A pallet with an out-of-tolerance component can leave the dispatch bay."

def dig(s):
    return hashlib.sha256(s.encode()).hexdigest()

@pytest.fixture
def sc(direct_deploy):
    return direct_deploy(CONTRACT)

@pytest.fixture
def owner(direct_owner):
    return direct_owner

@pytest.fixture
def reviewer(direct_bob):
    return direct_bob

@pytest.fixture
def outsider(direct_charlie):
    return direct_charlie

@pytest.fixture
def sys1(sc, reviewer):
    sc.create_system("A conveyor line.", json.dumps([HAZ_A, HAZ_B]), str(reviewer))
    return sc
