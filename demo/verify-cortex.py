#!/usr/bin/env python3
"""Exercise the real Cortex demo. Run against a disposable local demo database."""
import json
import os
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("CORTEX_URL", "http://127.0.0.1:8096") + "/dashboard/api/dashboard/v1"
TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf"))["token"]
PREFIX = "verify-" + uuid.uuid4().hex[:8]


def call(intent, values=None, command=False, expected=None, key=None):
    envelope = {"envelope": "v1", "kind": "command" if command else "query", "contributor": "cortex", "intent": intent, "context": {}}
    envelope["payload" if command else "params"] = values or {}
    if command:
        envelope.update(csrf=TOKEN, idempotencyKey=key or str(uuid.uuid4()))
    req = urllib.request.Request(BASE, data=json.dumps(envelope).encode(), headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(req)
    except urllib.error.HTTPError as error:
        response = error
    result = json.load(response)
    if expected:
        assert not result["ok"] and result["error"]["code"] == expected, (intent, result)
        return result
    assert result["ok"], (intent, result)
    return result.get("data")


def create(resource, data):
    return call(resource + ".create", {"data": {"name": PREFIX + "-" + resource, **data}}, True)


def run(agent_id, text, session_id=""):
    started = call("runs.start", {"id": agent_id, "input": text, "session_id": session_id}, True)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        feed = call("runs.events", {"id": started["id"]})
        if feed["done"]:
            return call("runs.detail", {"id": started["id"]}), feed
        time.sleep(0.05)
    raise AssertionError("Run did not settle")


role = os.environ.get("CORTEX_ROLE", "operator")
if role == "denied":
    call("agents.list", expected="PERMISSION_DENIED")
    print("PASS denied principal cannot read Cortex")
    raise SystemExit
if role == "reader":
    assert call("agents.list")["total"] >= 2
    call("agents.create", {"data": {"name": PREFIX}}, True, "PERMISSION_DENIED")
    assert not call("runtime.detail")["permissions"]["manage"]
    print("PASS reader can read and cannot manage")
    raise SystemExit

skill = create("skills", {"description": "Nested integration verification", "default_proficiency": "expert", "system_prompt_fragment": "Check evidence", "tools": [{"tool_name": "demo_lookup", "mastery": "expert", "guidance": "Review first", "prefer_when": "Local test"}], "knowledge": [{"source": "manual", "inject_mode": "tool", "priority": 2}]})
trait = create("traits", {"category": "risk", "dimensions": [{"name": "care", "value": 0.7, "low_label": "Low", "high_label": "High"}], "influences": [{"target": "prompt_injection", "value": "Verify", "weight": 1}]})
behavior = create("behaviors", {"priority": 2, "requires_skill": skill["name"], "requires_trait": trait["name"], "triggers": [{"type": "on_input", "pattern": "review"}], "actions": [{"type": "modify_param", "target": "review", "value": {"nested": [1, False]}}]})
persona = create("personas", {"identity": "Local reviewer", "skills": [{"skill_name": skill["name"], "proficiency": "expert"}], "traits": [{"trait_name": trait["name"], "dimension_values": {"care": 0.9}}], "behaviors": [behavior["name"]], "cognitive_style": {"phases": [{"strategy": "analytical", "max_steps": 2, "transition": "after_steps"}], "depth_preference": 0.8}, "communication_style": {"tone": "direct", "formality": 0.3}, "perception": {"context_window": 0.8, "detail_orientation": 0.9, "attention_filters": [{"name": "sources", "keywords": ["source"], "prompt": "Verify"}]}})
agent = create("agents", {"description": "Keep this", "enabled": True, "model": "demo-local", "persona_ref": persona["name"], "inline_skills": [skill["name"]], "inline_traits": [trait["name"]], "inline_behaviors": [behavior["name"]], "tools": ["demo_lookup"], "max_steps": 8, "sections": [{"id": "role", "body": "Check the source", "source": "host", "order": 1, "locked": True}]})
orch = create("orchestrations", {"strategy": "sequential", "participants": [{"agent_name": agent["name"], "role": "reviewer"}], "settings": {"max_concurrency": 1}})
for resource, row in [("skills", skill), ("traits", trait), ("behaviors", behavior), ("personas", persona), ("agents", agent), ("orchestrations", orch)]:
    saved = call(resource + ".detail", {"id": row["id"]})
    assert saved["name"] == row["name"] and saved["scope"] == row["scope"]
    call(resource + ".update", {"id": row["id"], "patch": {"description": "Updated over HTTP"}}, True)
    saved = call(resource + ".detail", {"id": row["id"]})
    for field, value in row.items():
        if field not in ("description", "updated_at"):
            assert saved.get(field) == value, (resource, field, saved, row)
    page = call(resource + ".list", {"search": PREFIX, "limit": 1})
    assert page["total"] == 1 and len(page["items"]) == 1
call("skills.delete", {"id": skill["id"]}, True, "CONFLICT")
call("agents.update", {"id": agent["id"], "patch": {"reasoning_loop": "unimplemented"}}, True, "BAD_REQUEST")
call("agents.update", {"id": agent["id"], "patch": {"temperature": 9}}, True, "BAD_REQUEST")
call("agents.update", {"id": agent["id"], "patch": {"enabled": False, "tools": []}}, True)
saved = call("agents.detail", {"id": agent["id"]})
assert saved["enabled"] is False and not saved.get("tools") and saved["sections"] == agent["sections"]
call("agents.update", {"id": agent["id"], "patch": {"enabled": True, "tools": ["demo_lookup"]}}, True)
assert call("references.list", {"kind": "personas", "owner_kind": "agents", "owner_id": agent["id"], "search": PREFIX})["total"] == 1
assert "Check the source" in call("prompt.preview", {"id": agent["id"]})["prompt"]
overlay = call("overlays.save", {"agent_id": agent["id"], "patches": [{"id": "role", "mode": "append", "body": "Overlay evidence"}]}, True)
assert "Overlay evidence" in call("prompt.preview", {"id": agent["id"]})["prompt"]
assert any(t["Name"] == "demo_lookup" for t in call("tools.list", {"id": agent["id"]})["items"])
assert call("tools.usage", {"id": agent["id"], "name": "demo_lookup"})["calls"] == 0

session = call("sessions.create", {"agent_id": agent["id"], "title": "HTTP review"}, True)
detail, feed = run(agent["id"], "persistent evidence", session["id"])
assert detail["run"]["state"] == "completed"
assert any(e["event"] == "token" for e in feed["events"])
assert len(call("memory.detail", {"id": session["id"]})["messages"]) == 2
call("sessions.update", {"id": session["id"], "title": "Renamed HTTP review"}, True)
assert call("memory.detail", {"id": session["id"]})["session"]["title"] == "Renamed HTTP review"
failed, _ = run(agent["id"], "fail-demo", session["id"])
assert failed["run"]["state"] == "failed" and failed["run"]["error"]

for approve in (True, False):
    paused, feed = run(agent["id"], "request approval", session["id"])
    assert paused["run"]["state"] == "paused" and any(e["event"] == "suspended" for e in feed["events"])
    checkpoints = call("checkpoints.list", {"limit": 100})["items"]
    checkpoint = next(c for c in checkpoints if c["run_id"] == paused["run"]["id"])
    call("checkpoints.resolve", {"id": checkpoint["id"], "approved": approve, "reason": "HTTP local test"}, True)
    decision = call("checkpoints.detail", {"id": checkpoint["id"]})["decision"]
    assert decision["decided_by"] == "cortex-demo-operator" and decision["approved"] == approve
    call("checkpoints.resolve", {"id": checkpoint["id"], "approved": approve, "reason": "Repeat decision"}, True, "CONFLICT")
assert call("agents.stats", {"id": agent["id"]})["total"] == 4
assert call("tools.usage", {"id": agent["id"], "name": "demo_lookup"})["calls"] >= 1
started = call("runs.start", {"id": agent["id"], "input": "cancel this " * 100}, True)
call("runs.cancel", {"id": started["id"]}, True)
assert call("runs.detail", {"id": started["id"]})["run"]["state"] == "cancelled"
call("orchestrations.execute", {"id": orch["id"], "input": "review local evidence"}, True)
assert call("orchestrationRuns.list")["items"]
message = call("messages.send", {"receiver_id": agent["id"], "content": "HTTP operator note"}, True)
conversation = call("conversations.detail", {"id": message["conversation_id"]})
saved_message = next(m for m in conversation["messages"] if m["id"] == message["message_id"])
assert saved_message["content"] == "HTTP operator note"
assert saved_message["sender"]["agent"] == "operator:cortex-demo-operator"
assert saved_message["receivers"][0]["agent"] == agent["name"]
assert isinstance(call("messages.inbox", {"id": agent["id"]}, True)["items"], list)
for intent in ("knowledge.list", "safety.profiles", "safety.scans"):
    assert call(intent)["available"] is False

call("memory.clear", {"id": session["id"]}, True)
assert call("memory.detail", {"id": session["id"]})["messages"] == []
call("sessions.delete", {"id": session["id"]}, True)
call("overlays.delete", {"id": overlay["id"]}, True)
for resource, row in [("orchestrations", orch), ("agents", agent), ("personas", persona), ("behaviors", behavior), ("traits", trait), ("skills", skill)]:
    call(resource + ".delete", {"id": row["id"]}, True)
    call(resource + ".detail", {"id": row["id"]}, expected="NOT_FOUND")
print("PASS HTTP CRUD, nested patches, references, stream, failures, approvals/rejections, cancellation, memory, overlays, orchestration and messaging")
