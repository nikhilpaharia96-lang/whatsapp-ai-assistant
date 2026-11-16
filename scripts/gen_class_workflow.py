#!/usr/bin/env python3
"""SDK source for the 'Class Notes' sub-workflow (n8n-workflows/class-notes/notes.js)."""
import json, os, sys
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'n8n-workflows', 'class-notes')
js = open(os.path.join(d, 'notes.js')).read()
out = "import { workflow, node, trigger } from '@n8n/workflow-sdk';\n\n"
out += "const start = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1, config: { name: 'Class Note Received', parameters: { inputSource: 'passthrough' }, position: [0, 300] }, output: [{ number: '919900000001', instanceName: 'NikhilAssistant', messageId: 'A1', seconds: 3600 }] });\n"
out += "const make = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Make Class Notes PDF', parameters: { jsCode: " + json.dumps(js, ensure_ascii=False) + " }, position: [250, 300] }, output: [{ ok: true }] });\n"
out += "\nexport default workflow('class-notes', 'Class Notes (voice -> PDF)').add(start).to(make);\n"
open(sys.argv[1] if len(sys.argv) > 1 else '/dev/stdout', 'w').write(out)
