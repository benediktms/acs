ALTER TABLE binding_claims ADD COLUMN principal_scopes_json TEXT NOT NULL DEFAULT '["a2a:send","a2a:read","a2a:cancel","executor","inbox"]' CHECK (json_valid(principal_scopes_json));
ALTER TABLE binding_claims ADD COLUMN delivery_policy_json TEXT NOT NULL DEFAULT '{"interruptOnCancel":false,"allowPeerPreemption":false}' CHECK (json_valid(delivery_policy_json));
ALTER TABLE delivery_intents ADD COLUMN preemption_status_json TEXT NOT NULL DEFAULT '{"requested":false,"attempted":false,"state":"not-requested"}' CHECK (json_valid(preemption_status_json));
