package main

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/planning"
)

const cortexPlanningPlannerRole = "[local-warehouse-team/v2:planner]"
const cortexPlanningProducerRole = "[local-warehouse-team/v2:producer]"
const cortexPlanningReviewerRole = "[local-warehouse-team/v2:reviewer]"

// The schema constrains structure only. Current policy and independent result
// validation still decide whether a generated document may be accepted.
func cortexPlanningResponseFormat(request *llm.Request) (json.RawMessage, error) {
	if request == nil || len(request.Messages) != 1 || request.Messages[0].Role != "user" {
		return nil, planning.ErrInvalid
	}
	roles := 0
	for _, role := range []string{cortexPlanningPlannerRole, cortexPlanningProducerRole, cortexPlanningReviewerRole} {
		if strings.Contains(request.System, role) {
			roles++
		}
	}
	if roles != 1 {
		return nil, planning.ErrInvalid
	}
	var document any
	switch {
	case strings.Contains(request.System, cortexPlanningPlannerRole):
		var value planning.Plan
		if err := cortexPlanningFormatDocument(request.Messages[0].Content, "Document: ", &value); err != nil {
			return nil, err
		}
		document = value
	case strings.Contains(request.System, cortexPlanningReviewerRole):
		var value coordination.ReviewOutput
		if err := cortexPlanningFormatDocument(request.Messages[0].Content, "Template: ", &value); err != nil {
			return nil, err
		}
		document = value
	default:
		document = struct {
			Record   string `json:"record"`
			Units    int    `json:"units"`
			Status   string `json:"status"`
			Revision string `json:"revision"`
		}{}
	}
	body, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	var sample any
	if decodeErr := decoder.Decode(&sample); decodeErr != nil {
		return nil, decodeErr
	}
	remaining := 2048
	schema, err := cortexPlanningShape(sample, "", 0, &remaining)
	if err != nil {
		return nil, err
	}
	return json.Marshal(schema)
}
func cortexPlanningFormatDocument(input, marker string, result any) error {
	index := strings.LastIndex(input, marker)
	if index < 0 || !strings.HasSuffix(input, " /no_think") {
		return planning.ErrInvalid
	}
	body := strings.TrimSuffix(input[index+len(marker):], " /no_think")
	if len(body) > 16384 {
		return planning.ErrInvalid
	}
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(result); err != nil {
		return errors.Join(planning.ErrInvalid, err)
	}
	// json.Valid also rejects a trailing document while preserving whitespace.
	if !json.Valid([]byte(body)) {
		return planning.ErrInvalid
	}
	return nil
}
func cortexPlanningShape(value any, field string, depth int, remaining *int) (map[string]any, error) {
	*remaining--
	if depth > 20 || *remaining < 0 {
		return nil, planning.ErrInvalid
	}
	switch current := value.(type) {
	case map[string]any:
		properties := make(map[string]any, len(current))
		required := make([]string, 0, len(current))
		for key, child := range current {
			shape, err := cortexPlanningShape(child, key, depth+1, remaining)
			if err != nil {
				return nil, err
			}
			properties[key] = shape
			required = append(required, key)
		}
		sort.Strings(required)
		return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}, nil
	case []any:
		if len(current) == 0 || len(current) > 256 {
			return nil, planning.ErrInvalid
		}
		child, err := cortexPlanningShape(current[0], field, depth+1, remaining)
		if err != nil {
			return nil, err
		}
		return map[string]any{"type": "array", "items": child, "minItems": len(current), "maxItems": len(current)}, nil
	case string:
		schema := map[string]any{"type": "string", "maxLength": 4096}
		if field == "assessment" {
			schema["enum"] = []string{"supported", "contradicted", "missing_evidence"}
		}
		return schema, nil
	case json.Number:
		if _, err := current.Int64(); err != nil {
			return nil, planning.ErrInvalid
		}
		return map[string]any{"type": "integer"}, nil
	case bool:
		return map[string]any{"type": "boolean"}, nil
	default:
		return nil, planning.ErrInvalid
	}
}
