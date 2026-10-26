package main

import (
	"encoding/json"
	"strings"

	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
)

const cortexOptimizationDomain = "local-synthetic-record"

// This fixed host constrains output structure for every arm. Values still come
// from the model and remain subject to independent scoring and edit policy.
func cortexOptimizationResponseFormat(request *llm.Request) (json.RawMessage, error) {
	if request == nil || request.Model != "demo-local" || len(request.Tools) != 0 {
		return nil, opt.ErrInvalidSpec
	}
	operation := "record"
	for _, candidate := range []string{"propose", "compose", "reflect"} {
		if strings.Contains(request.System, "JSON for the "+candidate+" operation") {
			if operation != "record" {
				return nil, opt.ErrInvalidSpec
			}
			operation = candidate
		}
	}
	if operation != "record" {
		if _, _, err := cortexOptimizationControllerRoute(request); err != nil {
			return nil, err
		}
	}
	const record = `{"type":"object","properties":{"record":{"type":"string"},"units":{"type":"integer"},"status":{"type":"string"},"revision":{"type":"string"}},"required":["record","units","status","revision"],"additionalProperties":false}`
	const proposal = `{"type":"object","properties":{"edits":{"type":"array","minItems":0,"maxItems":1,"items":{"type":"object","properties":{"kind":{"type":"string","enum":["section_body"]},"target":{"type":"string"},"text":{"type":"string","maxLength":512}},"required":["kind","target","text"],"additionalProperties":false}},"rationale":{"type":"string","maxLength":512},"evidence_ids":{"type":"array","minItems":0,"maxItems":4,"items":{"type":"string"}}},"required":["edits","rationale","evidence_ids"],"additionalProperties":false}`
	const reflection = `{"type":"object","properties":{"lessons":{"type":"array","minItems":0,"maxItems":2,"items":{"type":"object","properties":{"statement":{"type":"string","maxLength":512},"domain":{"type":"string","enum":["local-synthetic-record"]},"applicability":{"type":"array","maxItems":4,"items":{"type":"string"}},"contraindications":{"type":"array","maxItems":4,"items":{"type":"string"}},"evidence_ids":{"type":"array","maxItems":4,"items":{"type":"string"}}},"required":["statement","domain","applicability","contraindications","evidence_ids"],"additionalProperties":false}}},"required":["lessons"],"additionalProperties":false}`
	switch operation {
	case "propose":
		return json.RawMessage(`{"type":"object","properties":{"proposals":{"type":"array","minItems":1,"maxItems":1,"items":` + proposal + `}},"required":["proposals"],"additionalProperties":false}`), nil
	case "compose":
		return json.RawMessage(`{"type":"object","properties":{"proposal":` + proposal + `},"required":["proposal"],"additionalProperties":false}`), nil
	case "reflect":
		return json.RawMessage(reflection), nil
	default:
		return json.RawMessage(record), nil
	}
}

func cortexOptimizationControllerRoute(request *llm.Request) (operationName, domainName string, resultErr error) {
	if request == nil || len(request.Messages) != 1 || request.Messages[0].Role != "user" || len(request.Messages[0].Content) > cortexOptimizationFeedbackBytes {
		return "", "", opt.ErrInvalidSpec
	}
	var projection cortexOptimizationFeedbackInput
	if err := cortexOptimizationDecodeExact([]byte(request.Messages[0].Content), &projection); err != nil {
		return "", "", err
	}
	if projection.Revision != cortexOptimizationFeedbackRevision {
		return "", "", opt.ErrStaleVersion
	}
	matched := ""
	for _, operation := range []string{"propose", "compose", "reflect"} {
		if strings.Contains(request.System, "JSON for the "+operation+" operation") {
			if matched != "" {
				return "", "", opt.ErrInvalidSpec
			}
			matched = operation
		}
	}
	if matched == "" || matched != projection.Operation {
		return "", "", opt.ErrInvalidSpec
	}
	if (matched == "reflect" && projection.Domain != cortexOptimizationDomain) || (matched != "reflect" && projection.Domain != "") {
		return "", "", opt.ErrPolicyDenied
	}
	return matched, projection.Domain, nil
}
