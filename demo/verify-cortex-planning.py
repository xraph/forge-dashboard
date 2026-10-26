#!/usr/bin/env python3
"""Exercise the selected warehouse team through its installed dashboard contract."""
import json
import hashlib
import os
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("CORTEX_URL", "http://127.0.0.1:8937") + "/dashboard/api/dashboard/v1"
TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]
RECEIPT = os.environ.get("CORTEX_PLANNING_RECEIPT")


def call(intent, values=None, command=False, expected=None):
    body = {"envelope": "v1", "kind": "command" if command else "query", "contributor": "cortex", "intent": intent, "context": {}}
    body["payload" if command else "params"] = values or {}
    if command:
        key = hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        body.update(csrf=TOKEN, idempotencyKey=key)
    request = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=330)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        result = json.load(response)
    if expected:
        assert not result["ok"] and result["error"]["code"] in expected, (intent, result)
        return result
    assert result["ok"], (intent, result.get("error", {}).get("code"))
    return result.get("data")


def identifier(prefix):
    value, encoded = uuid.uuid4().int, ""
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
    for _ in range(26):
        encoded = alphabet[value & 31] + encoded
        value >>= 5
    return prefix + "_" + encoded


def persist(value):
    if RECEIPT:
        descriptor = os.open(RECEIPT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(value, target)
            target.flush()
            os.fsync(target.fileno())


def command(detail, operation, key, **extra):
    return {"operation": operation, "operation_id": key, "plan_id": detail["plan"]["id"], "expected_revision": detail["plan"]["revision"], "expected_digest": detail["plan"]["digest"], "reason": "Installed warehouse team qualification", **extra}


assert "Ollama" in json.dumps(call("runtime.detail")), "local provider must be explicit"
resume = os.environ.get("CORTEX_PLANNING_RESUME")
if resume:
    saved = json.load(open(resume, encoding="utf-8"))
    detail = call("planning.detail", {"id": saved["plan_id"]})
else:
    page = call("planning.list", {"limit": 25})
    assert page["available"] and len(page["items"]) == 1, "selected team must be installed"
    detail = call("planning.detail", {"id": page["items"][0]["id"]})
    saved = {"plan_id": detail["plan"]["id"]}
    persist(saved)

if os.environ.get("CORTEX_PLANNING_RESTART_CHECK"):
    if saved.get("proposal_acceptance"):
        call("planning.command", saved["proposal_acceptance"], True)
    assert detail["complete"] and detail["tasks"][0]["currently_accepted"]
    assert detail["tasks"][0]["run_id"] == saved["producer_run_id"]
    assert detail["tasks"][0]["acceptance_id"] == saved["acceptance_id"]
    assert detail["replans"][0]["run_id"] == saved["planner_run_id"]
    print("PASS restarted host resolves the same accepted task and planner identities")
    raise SystemExit(0)

if detail["plan"]["revision"] == 1:
    if not detail["replans"]:
        proposal_id = saved.get("proposal_id", identifier("rplan"))
        saved["proposal_id"] = proposal_id
        persist(saved)
        call("planning.command", command(detail, "propose_revision", proposal_id), True)
        detail = call("planning.detail", {"id": saved["plan_id"]})
    proposal = detail["replans"][0]
    call("planning.command", command(detail, "observe_revision", proposal["id"]), True)
    detail = call("planning.detail", {"id": saved["plan_id"]})
    proposal = detail["replans"][0]
    assert proposal["status"] == "proposed", "planner output did not validate as a bounded graph"
    assert len(proposal["proposed_tasks"]) == 1 and proposal["proposed_tasks"][0]["review_required"]
    acceptance = command(detail, "accept_revision", proposal["id"])
    saved["proposal_acceptance"] = acceptance
    persist(saved)
    call("planning.command", acceptance, True)
    call("planning.command", acceptance, True)
    detail = call("planning.detail", {"id": saved["plan_id"]})
    print("PASS actual planner proposal, explicit graph acceptance and historical acknowledgment")

saved["planner_run_id"] = detail["replans"][0]["run_id"]
task = detail["tasks"][0]
if not task.get("claim_id"):
    key = saved.get("claim_id", identifier("tclaim"))
    saved["claim_id"] = key
    persist(saved)
    call("planning.command", command(detail, "claim", key, task_id=task["id"]), True)
    detail = call("planning.detail", {"id": saved["plan_id"]})
    task = detail["tasks"][0]
saved["producer_run_id"] = task["run_id"]
persist(saved)
if not task["currently_accepted"]:
    assert task.get("assignment_id"), "producer requires durable assignment"
    call("planning.command", command(detail, "reconcile", task["assignment_id"], task_id=task["id"], expected_claim_revision=task["claim_revision"], expected_assignment_revision=task["assignment_revision"]), True)
    detail = call("planning.detail", {"id": saved["plan_id"]})
    task = detail["tasks"][0]
assert detail["complete"] and task["currently_accepted"] and task.get("accepted_artifact"), "review and verification did not establish current acceptance"
saved["acceptance_id"] = task["acceptance_id"]
saved["artifact_id"] = task["accepted_artifact"]["id"]
persist(saved)
producer = call("runs.detail", {"id": saved["producer_run_id"]})["run"]
assert producer["verification_status"] == "passed" and producer.get("result_ref")
assert not producer.get("output"), "metadata exposed protected candidate"
content = call("runs.result", {"id": producer["id"], "result_id": producer["result_ref"]})
assert json.loads(content["content"]) == {"record": "warehouse-7", "units": 17, "status": "reviewed", "revision": "demo-record-v1"}
print("PASS actual producer, required contextual checks, independent review and task acceptance")

reader = os.environ.get("CORTEX_READER_URL")
if reader:
    BASE = reader + "/dashboard/api/dashboard/v1"
    TOKEN = json.load(urllib.request.urlopen(BASE + "/csrf", timeout=10))["token"]
    visible = call("planning.detail", {"id": saved["plan_id"]})
    assert visible["complete"] and visible["tasks"][0]["acceptance_id"] == saved["acceptance_id"]
    denied = command(visible, "claim", identifier("tclaim"), task_id=task["id"])
    call("planning.command", denied, True, ("PERMISSION_DENIED",))
    print("PASS reader can inspect current acceptance and cannot dispatch")
print("QUALIFIED selected no-tool warehouse team; general model accuracy and external-effect recovery are separate qualifications")
