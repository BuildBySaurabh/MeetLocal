// A stand-in for Ollama's HTTP API, for testing MeetLocal's assistant plumbing WITHOUT a real model.
// It is not a language model: its "answer" just reports what it was sent. Usage: node scripts/fake-ollama.mjs [port]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 11434);
const requests = [];

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.url === '/__requests') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(requests));
  if (req.url === '/api/tags') {
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'fake-model:latest' }] }));
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const user = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
      const system = parsed.messages.find((m) => m.role === 'system')?.content ?? '';
      const target = /Translate the text inside <text> tags into ([^.]+)\./.exec(system)?.[1];
      const lines = (user.match(/\] You: /g) ?? []).length;
      const reply = target
        ? `[${target}] ${/<text>([\s\S]*)<\/text>/.exec(user)?.[1] ?? ''}`
        : `From the transcript: received ${lines} line(s) via model ${parsed.model}.\nSuggestions (not from the transcript): None.`;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      let i = 0;
      const words = reply.split(' ');
      const timer = setInterval(() => {
        if (i < words.length) res.write(JSON.stringify({ message: { role: 'assistant', content: (i ? ' ' : '') + words[i++] }, done: false }) + '\n');
        else {
          res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n');
          clearInterval(timer);
        }
      }, 20);
    });
    return;
  }
  res.writeHead(404).end('{}');
}).listen(port, '127.0.0.1', () => console.log(`fake ollama on ${port}`));
