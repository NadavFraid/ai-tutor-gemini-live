const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('[LOG] Groq SDK Initialized successfully');
} else {
  console.error('[WARNING] GROQ_API_KEY is missing!');
}

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

// מודלים מעודכנים ופעילים ב-Groq
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama3-8b-8192',
  'mixtral-8x7b-32768'
];

wss.on('connection', (ws, req) => {
  console.log(`[LOG] New client connected from ${req.socket.remoteAddress}`);

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'text_query') {
        console.log(`[LOG] Query received: "${parsed.text}"`);

        if (!groq) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'חסר GROQ_API_KEY בשרת.' 
          }));
          return;
        }

        messages.push({ role: 'user', content: parsed.text });

        let stream = null;
        let lastError = null;

        // ניסיון התחברות למודלים פעילים ברשימה
        for (const modelName of GROQ_MODELS) {
          try {
            stream = await groq.chat.completions.create({
              messages: messages,
              model: modelName,
              temperature: 0.6,
              max_tokens: 300,
              stream: true,
            });
            console.log(`[LOG] Using active Groq model: ${modelName}`);
            break;
          } catch (err) {
            console.warn(`[WARN] Model ${modelName} failed, trying next...`);
            lastError = err;
          }
        }

        if (!stream) {
          throw lastError || new Error('No Groq models available');
        }

        let fullText = '';
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            ws.send(JSON.stringify({ type: 'text_chunk', text: content }));
          }
        }

        messages.push({ role: 'assistant', content: fullText });
        ws.send(JSON.stringify({ type: 'stream_end', fullText: fullText }));
      }
    } catch (err) {
      console.error('[ERROR] Processing failed:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
