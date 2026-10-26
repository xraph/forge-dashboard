#!/usr/bin/env python3
"""Qualify the local model over the installed dashboard contract transport."""
import json
import os
import time
import urllib.request
import urllib.error
import uuid

BASE = os.environ.get("CORTEX_URL", "http://127.0.0.1:8937") + "/dashboard/api/dashboard/v1"
TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]


def call(intent, values=None, command=False, expected=None):
    body = {"envelope": "v1", "kind": "command" if command else "query", "contributor": "cortex", "intent": intent, "context": {}}
    body["payload" if command else "params"] = values or {}
    if command:
        body.update(csrf=TOKEN, idempotencyKey=str(uuid.uuid4()))
    request = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        result = json.load(response)
    if expected:
        assert not result["ok"] and result["error"]["code"] == expected, result
        assert not result["error"].get("retryable", False), "policy denial must not suggest retry"
        return result
    assert result["ok"], (intent, result.get("error", {}).get("code"))
    return result.get("data")


def execute(agent, text):
    started = call("runs.start", {"id": agent, "input": text}, True)
    end = time.monotonic() + 120
    while time.monotonic() < end:
        feed = call("runs.events", {"id": started["id"]})
        if feed["done"]:
            return call("runs.detail", {"id": started["id"]}), feed
        time.sleep(0.1)
    raise AssertionError("Live run did not terminate within 120 seconds")


runtime = call("runtime.detail")
assert "Ollama" in json.dumps(runtime), "host must explicitly advertise real local provider"
agent = call("agents.create", {"data": {"name": "live-qualification-" + uuid.uuid4().hex[:8], "model": "demo-local", "enabled": True, "tools": [], "max_tokens": 4096, "temperature": 0, "max_steps": 2, "sections": [{"id": "role", "body": "Follow the requested format. Use no tools. /no_think", "source": "host", "order": 1, "locked": True}]}}, True)
for prompt, expected in [
    ("/no_think Reply exactly CORTEX_HTTP_OK.", "CORTEX_HTTP_OK"),
    ("/no_think Write a single email address using user alice and domain example dot com. Output only that address.", "[email]"),
]:
    detail, feed = execute(agent["id"], prompt)
    row = detail["run"]
    assert row["state"] == "completed", row["state"]
    assert expected in row["output"], "expected checked output absent"
    assert row.get("verification_status") == "unchecked", "provider answer cannot self-verify"
    assert "alice@example.com" not in json.dumps(feed), "unscreened email leaked to public feed"
    assert row["provenance"]["publication_status"] in ("approved", "redacted")
    print("PASS installed model and publication", expected, row["id"])

# Exercise the installed model's real tool selection and the host approval gate.
call("agents.update", {"id": agent["id"], "patch": {"tools": ["demo_lookup"], "max_steps": 4, "max_tokens": 4096, "sections": [{"id": "role", "body": "Call the requested tool before answering. /no_think", "source": "host", "order": 1, "locked": True}]}}, True)
paused, _ = execute(agent["id"], "/no_think Call demo_lookup exactly once to read the local record, then summarize its result. You must call the tool before answering.")
assert paused["run"]["state"] == "paused", "real model did not enter the required tool approval path"
checkpoint = next(row for row in call("checkpoints.list", {"limit": 100})["items"] if row["run_id"] == paused["run"]["id"])
call("checkpoints.resolve", {"id": checkpoint["id"], "approved": True, "reason": "Installed local model qualification"}, True)
resumed = call("runs.detail", {"id": paused["run"]["id"]})["run"]
assert resumed["state"] == "completed", ("approved live run", resumed["state"])
assert resumed.get("verification_status") == "unchecked"
assert call("tools.usage", {"id": agent["id"], "name": "demo_lookup"})["calls"] >= 1
print("PASS installed model tool selection, approval and resumed unchecked answer")

call("agents.update", {"id": agent["id"], "patch": {"max_steps": 1}}, True)
last, _ = execute(agent["id"], "/no_think Call demo_lookup exactly once. Do not answer before calling it.")
assert last["run"]["state"] == "paused", "last-step tool did not request approval"
checkpoint = next(row for row in call("checkpoints.list", {"limit": 100})["items"] if row["run_id"] == last["run"]["id"])
call("checkpoints.resolve", {"id": checkpoint["id"], "approved": True, "reason": "Last-step qualification"}, True, "CONFLICT")
assert call("checkpoints.detail", {"id": checkpoint["id"]})["decision"]["approved"]
exhausted = call("runs.detail", {"id": last["run"]["id"]})["run"]
assert exhausted["state"] == "incomplete" and exhausted["stop_reason"] == "step_limit", exhausted["state"]
print("PASS installed last-step approval cannot fabricate a final answer")

call("agents.update", {"id": agent["id"], "patch": {"max_tokens": 1, "tools": []}}, True)
truncated, feed = execute(agent["id"], "/no_think Write a detailed paragraph about a library.")
assert truncated["run"]["state"] == "incomplete", "truncated generation was reported complete"
assert truncated["run"]["stop_reason"] in ("token_limit", "length")
print("PASS installed output exhaustion remains incomplete")

blocked = call("runs.start", {"id": agent["id"], "input": "password=qualification_secret_123456789"}, True, "PERMISSION_DENIED")
assert "qualification_secret_123456789" not in json.dumps(blocked), "blocked content leaked into response"
print("PASS installed credential denial")
call("agents.update", {"id": agent["id"], "patch": {"max_tokens": 4096, "max_steps": 2}}, True)
started = call("runs.start", {"id": agent["id"], "input": "/no_think Write 200 numbered paragraphs about libraries."}, True)
call("runs.cancel", {"id": started["id"]}, True)
cancelled = call("runs.detail", {"id": started["id"]})["run"]
assert cancelled["state"] == "cancelled"
assert cancelled.get("verification_status") == "unchecked"
print("PASS installed cancellation remains cancelled and unchecked")

reader = os.environ.get("CORTEX_READER_URL")
isolated = os.environ.get("CORTEX_ISOLATED_URL")
assert bool(reader) == bool(isolated), "supply both principal qualification endpoints"
if reader:
    original_base = BASE
    BASE = reader + "/dashboard/api/dashboard/v1"
    TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]
    assert call("agents.detail", {"id": agent["id"]})["id"] == agent["id"]
    call("agents.update", {"id": agent["id"], "patch": {"name": "reader-must-not-edit"}}, True, "PERMISSION_DENIED")
    BASE = isolated + "/dashboard/api/dashboard/v1"
    call("agents.detail", {"id": agent["id"]}, expected="NOT_FOUND")
    BASE = original_base
    print("PASS installed read-only principal and isolated tenant")
else:
    print("NOT RUN additional principal/scope hosts; set CORTEX_READER_URL and CORTEX_ISOLATED_URL")
print("QUALIFIED local model and selected HTTP publication/outcome cases")
