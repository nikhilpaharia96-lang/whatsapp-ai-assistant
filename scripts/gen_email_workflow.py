#!/usr/bin/env python3
"""Generate the n8n SDK source for the 'Email Replies' workflow from the JS/SQL pieces in n8n-workflows/email-replies/."""
import json, os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
d = os.path.join(root, 'n8n-workflows', 'email-replies')
main = json.load(open(os.path.join(root, 'n8n-workflows', 'main-workflow.json')))
bap = next(n for n in main['nodes'] if n['name'] == 'Build AI Prompt')['parameters']['jsCode']
rules = bap.split('const clientRules = `', 1)[1].split('`;const colleagueRules', 1)[0]
def js(name):
    s = open(os.path.join(d, name)).read()
    return s.replace('__CLIENT_RULES__', rules)
def q(name):
    return open(os.path.join(d, name)).read().strip()
J = lambda s: json.dumps(s, ensure_ascii=False)
CRED_PG = "{ postgres: newCredential('Postgres account') }"
def code(var, name, file, sample, x):
    return f"const {var} = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: {J(name)}, parameters: {{ jsCode: {J(js(file))} }}, position: [{x}, 300] }}, output: [{sample}] }});\n"
def pg(var, name, sqlfile, repl, sample, x, extra=''):
    opts = f"options: {{ queryReplacement: expr({J(repl)}) }}" if repl else "options: {}"
    return f"const {var} = node({{ type: 'n8n-nodes-base.postgres', version: 2.8, config: {{ name: {J(name)}, parameters: {{ resource: 'database', operation: 'executeQuery', query: {J(q(sqlfile))}, {opts} }}, credentials: {CRED_PG}, position: [{x}, 300]{extra} }}, output: [{sample}] }});\n"
out = "import { workflow, node, trigger, newCredential, ifElse, expr } from '@n8n/workflow-sdk';\n\n"
out += "const gmailTrigger = trigger({ type: 'n8n-nodes-base.gmailTrigger', version: 1.4, config: { name: 'New Email', parameters: { pollTimes: { item: [{ mode: 'everyMinute' }] }, event: 'messageReceived', simple: false, maxResults: 1, filters: { labelIds: ['INBOX'], readStatus: 'both' } }, credentials: { gmailOAuth2: newCredential('Gmail account') }, position: [0, 300] }, output: [{ id: 'm1', threadId: 't1', subject: 'Re: Hello', text: 'Yes please', labelIds: ['INBOX'], from: { value: [{ address: 'a@b.com', name: 'A' }] } }] });\n"
out += code('prepare', 'Prepare Email', 'prepare.js', "{ msgId: 'm1', threadId: 't1', fromEmail: 'a@b.com', fromName: 'A', subject: 'Re: Hello', body: 'Yes please', optOut: false }", 250)
out += pg('findContact', 'Find Contact by Thread', 'find_contact.sql', '{{ $json.threadId }}, {{ $json.msgId }}', "{ id: 'c1', display_name: 'A', in_msg_id: 'm1', seen: false, bot_off: false }", 500)
out += code('decide', 'Decide Handling', 'decide.js', "{ msgId: 'm1', mode: 'reply', contactId: 'c1', contactName: 'A', fromEmail: 'a@b.com', subject: 'Re: Hello', body: 'Yes please', optOut: false }", 750)
out += pg('saveIncoming', 'Save Incoming Email', 'save_incoming.sql', '{{ $json.contactId }}, {{ $json.body }}, {{ $json.msgId }}, {{ $json.optOut }}, {{ $json.mode }}', "{ contact_id: 'c1', msg_id: 'm1', mode: 'reply' }", 1000)
out += """const shouldReply = ifElse({ version: 2.2, config: { name: 'Should AI reply?', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'reply' }], combinator: 'and' } }, position: [1250, 300] } });\n"""
out += pg('loadHistory', 'Load Email History', 'history.sql', '{{ $json.contact_id }}', "{ role: 'user', content: 'Yes please', created_at: '2026-11-14T00:00:00Z' }", 1500)
out += pg('loadPortfolio', 'Load Email Portfolio', 'portfolio.sql', '', "{ category: 'services', title: 'Websites', content: 'Starting Rs 2,999' }", 1750)
out += code('buildPrompt', 'Build Email Prompt', 'prompt.js', "{ geminiBody: { contents: [] }, msgId: 'm1', threadId: 't1', contactId: 'c1', contactName: 'A', fromEmail: 'a@b.com', subject: 'Re: Hello', body: 'Yes please', optOut: false }", 2000)
out += code('gemini', 'Gemini Email Call', 'gemini.js', "{ candidates: [{ content: { parts: [{ text: 'Hi A, great!' }] } }], usedModel: 'gemini' }", 2250)
out += code('parse', 'Parse Email Reply', 'parse.js', "{ msgId: 'm1', threadId: 't1', contactId: 'c1', fromEmail: 'a@b.com', subject: 'Re: Hello', body: 'Yes please', aiReply: 'Hi A', emailText: 'Hi A', tokensUsed: 10, model: 'gemini', needsEscalation: false }", 2500)
out += "const sendReply = node({ type: 'n8n-nodes-base.gmail', version: 2.2, config: { name: 'Send Email Reply', parameters: { resource: 'message', operation: 'reply', messageId: expr('{{ $json.msgId }}'), emailType: 'text', message: expr('{{ $json.emailText }}'), options: { appendAttribution: false, senderName: 'Nikhil Paharia', replyToSenderOnly: true } }, credentials: { gmailOAuth2: newCredential('Gmail account') }, onError: 'continueRegularOutput', position: [2750, 300] }, output: [{ id: 'r1', threadId: 't1' }] });\n"
out += code('normalize', 'Normalize Email Send', 'normalize.js', "{ sent: true, sentId: 'r1', contactId: 'c1', emailText: 'Hi A', tokensUsed: 10, model: 'gemini' }", 3000)
out += pg('saveReply', 'Save Email Reply', 'save_reply.sql', '{{ $json.contactId }}, {{ $json.aiReply }}, {{ $json.sentId }}, {{ $json.tokensUsed || 0 }}, {{ $json.model || "" }}, {{ $json.sent }}', "{ id: 'x1' }", 3250, ', alwaysOutputData: true')
out += code('notifyReply', 'Notify Owner (replied)', 'notify.js', "{ notified: true }", 3500)
out += code('notifySilent', 'Notify Owner (silent)', 'notify.js', "{ notified: true }", 1500).replace('position: [1500, 300]', 'position: [1500, 600]')
out += """
export default workflow('email-replies', 'Email Replies (Gmail, AI)')
  .add(gmailTrigger)
  .to(prepare)
  .to(findContact)
  .to(decide)
  .to(saveIncoming)
  .to(shouldReply
    .onTrue(loadHistory.to(loadPortfolio.to(buildPrompt.to(gemini.to(parse.to(sendReply.to(normalize.to(saveReply.to(notifyReply)))))))))
    .onFalse(notifySilent));
"""
open(sys.argv[1] if len(sys.argv) > 1 else '/dev/stdout', 'w').write(out)
