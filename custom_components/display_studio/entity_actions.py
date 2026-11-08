"""Bounded entity functions shared by the editor and all touch adapters."""
import json
from pathlib import Path

ENTITY_ACTIONS=json.loads(Path(__file__).with_name("entity_actions.json").read_text())


def action_supported(name,domain,attributes):
    spec=ENTITY_ACTIONS.get(name)
    if not spec or domain not in spec["domains"]:return False
    required=spec.get("features",{}).get(domain,0)
    features=attributes.get("supported_features")
    return not required or features is None or bool(int(features)&required)
