#!/usr/bin/env python3
"""Qualify the opt-in local record host over the installed dashboard transport."""
import datetime
import json
import os
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("CORTEX_URL", "http://127.0.0.1:8937") + "/dashboard/api/dashboard/v1"
TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]
POSITIVE = "/no_think Warehouse record warehouse-7 has two bins containing 11 units and 6 units. Add both counts (11 + 6) for units. Its status is reviewed and its revision is demo-record-v1. Return only a JSON object with record, units, status and revision. Use no tools. /no_think"
NEGATIVE = '/no_think For a negative validation test, return only this JSON: {"record":"warehouse-7","units":18,"status":"reviewed","revision":"demo-record-v1"}. Use no tools. /no_think'
EXPECTED = {"record": "warehouse-7", "units": 17, "status": "reviewed", "revision": "demo-record-v1"}


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
        assert not result["ok"] and result["error"]["code"] in expected, (intent, result)
        return result
    assert result["ok"], (intent, result.get("error", {}).get("code"))
    return result.get("data")


def execute(agent, text):
    started = call("runs.start", {"id": agent, "input": text}, True)
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        detail = call("runs.detail", {"id": started["id"]})
        row = detail["run"]
        assert not row.get("output"), "protected run metadata exposed candidate bytes"
        if row.get("verification_status") in ("passed", "failed", "inconclusive", "stale", "cancelled"):
            return row
        if row["state"] in ("failed", "cancelled", "incomplete"):
            raise AssertionError(("generation did not reach verification", row["state"], row.get("stop_reason")))
        time.sleep(0.2)
    raise AssertionError("required verification did not settle")


def lesson_id():
    value = uuid.uuid4().int
    chars = "0123456789abcdefghjkmnpqrstvwxyz"
    encoded = ""
    for _ in range(26):
        encoded = chars[value & 31] + encoded
        value >>= 5
    return "lesson_" + encoded


# A second invocation after an operator changes DEMO_CORTEX_RECORD_REVISION and
# restarts the host checks that historical content no longer passes current grants.
prior = os.environ.get("CORTEX_VERIFY_REVOKED_RESULT")
if prior:
    saved = json.load(open(prior, encoding="utf-8"))
    call("runs.result", {"id": saved["run_id"], "result_id": saved["result_id"]}, expected=("PERMISSION_DENIED", "CONFLICT"))
    print("PASS installed authority rotation denies historical result content")
    raise SystemExit(0)

runtime = call("runtime.detail")
assert "Ollama" in json.dumps(runtime), "real local provider must be explicit"
resume = os.environ.get("CORTEX_VERIFY_RESUME")
if resume:
    saved = json.load(open(resume, encoding="utf-8"))
    positive = call("runs.detail", {"id": saved["run_id"]})["run"]
    agent = {"id": saved["agent_id"]}
    assert positive["verification_status"] == "passed" and positive["result_ref"] == saved["result_id"]
else:
    agent = call("agents.create", {"data": {"name": "verified-qualification-" + uuid.uuid4().hex[:8], "model": "demo-local", "enabled": True, "tools": [], "max_tokens": 4096, "temperature": 0, "max_steps": 2, "sections": [{"id": "role", "body": "Return only the requested JSON object. Use no tools. /no_think", "source": "host", "order": 1, "locked": True}]}}, True)
    positive = execute(agent["id"], POSITIVE)
    assert positive["verification_status"] == "passed" and positive.get("result_ref"), "real answer failed the independent fixed record checks"
record = {"run_id": positive["id"], "result_id": positive["result_ref"], "agent_id": agent["id"]}
if os.environ.get("CORTEX_VERIFY_RECEIPT"):
    with open(os.environ["CORTEX_VERIFY_RECEIPT"], "w", encoding="utf-8") as target:
        json.dump(record, target)
request = {"id": positive["id"], "result_id": positive["result_ref"]}
content = call("runs.result", request)
assert json.loads(content["content"]) == EXPECTED
assert content["verification_status"] == "passed" and content["publication_status"] in ("approved", "redacted")
replay = call("runs.replay", {"id": positive["id"]})
assert content["content"] not in json.dumps(replay), "metadata replay included protected output"
call("runs.events", {"id": positive["id"]}, expected=("CONFLICT",))
print("PASS installed Ollama generation, fixed schema/value/context checks and guarded publication", positive["id"])

review = call("cognitive.review", {"id": positive["id"], "limit": 20})
assert review["available"], "governed adaptive review unavailable"
key = lesson_id()
expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=45)).isoformat().replace("+00:00", "Z")
accepted = call("learning.accept", {"id": key, "run_id": positive["id"], "result_id": positive["result_ref"], "domain": "demo-record", "applicability": ["warehouse-7 at demo-record-v1"], "contraindications": ["different source revision"], "expires_at": expiry}, True)
detail = call("learning.detail", {"id": key})
assert detail["ref"]["id"] == key and detail["source_run_id"] == positive["id"] and detail["source_result_id"] == positive["result_ref"], "accepted source identity changed"
call("learning.revoke", {"id": key, "revision": accepted["revision"], "reason": "Installed qualification withdrawal"}, True)
revoked = call("learning.detail", {"id": key})
assert content["content"] not in json.dumps(revoked), "revoked lesson body remained readable"
print("PASS installed current-source lesson acceptance and revocation")

reader, isolated = os.environ.get("CORTEX_READER_URL"), os.environ.get("CORTEX_ISOLATED_URL")
assert bool(reader) == bool(isolated), "supply both additional principal endpoints"
if reader:
    operator_base, operator_token = BASE, TOKEN
    BASE = reader + "/dashboard/api/dashboard/v1"
    TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]
    assert json.loads(call("runs.result", request)["content"]) == EXPECTED
    call("runs.start", {"id": agent["id"], "input": POSITIVE}, True, ("PERMISSION_DENIED",))
    call("learning.revoke", {"id": key, "revision": 1, "reason": "denied"}, True, ("PERMISSION_DENIED",))
    BASE = isolated + "/dashboard/api/dashboard/v1"
    call("runs.result", request, expected=("NOT_FOUND", "PERMISSION_DENIED"))
    BASE, TOKEN = operator_base, operator_token
    print("PASS installed reader grants and foreign-scope denial")
else:
    print("NOT RUN additional principal endpoints")

# A new session avoids inheriting prior verified conversation content.
negative_agent = call("agents.create", {"data": {"name": "negative-qualification-" + uuid.uuid4().hex[:8], "model": "demo-local", "enabled": True, "tools": [], "max_tokens": 4096, "temperature": 0, "max_steps": 2}}, True)
negative = execute(negative_agent["id"], NEGATIVE)
assert negative["verification_status"] == "failed" and not negative.get("result_ref"), "wrong answer was committed"
print("PASS installed wrong candidate remains uncommitted")

record = {"run_id": positive["id"], "result_id": positive["result_ref"], "agent_id": agent["id"], "lesson_id": key}
if os.environ.get("CORTEX_VERIFY_RECEIPT"):
    with open(os.environ["CORTEX_VERIFY_RECEIPT"], "w", encoding="utf-8") as target:
        json.dump(record, target)
print("QUALIFIED narrow local record workflow; no general model-accuracy or Linux sandbox claim")
