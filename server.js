const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

// רשימת מודלי צ'אט נתמכים בעדיפות ראשונה ב-Groq
const CANDIDATE_MODELS = [
  'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768',
  'llama3-70b-8192',
  'llama3-8b-8192'
];

let activeModelId = null;

async function getWorkingChatModel() {
  try {
    const modelsList = await groq.models.list();
    if (modelsList && modelsList.data) {
      const activeIds = modelsList.data.map(m => m.id);
      // מציאת המודל הראשון מהרשימה המומלצת שקיים בחשבון
      for (const candidate of CANDIDATE_MODELS) {
        if (activeIds.includes(candidate)) {
          console.log(`[LOG] Verified working Groq Chat model: ${candidate}`);
          return candidate;
        }
      }
    }
  } catch (err) {
    console.error('[ERROR] Failed listing models:', err.message);
  }
  return 'llama-3.3-70b-versatile';
}

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected');
  
  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION }
  ];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'text_query') {
        console.log(`[LOG] User query: "${parsed.text}"`);

        messages.push({ role: 'user', content: parsed.text });

        if (!activeModelId) {
          activeModelId = await getWorkingChatModel();
        }

        const stream = await groq.chat.completions.create({
          messages: messages,
          model: activeModelId,
          temperature: 0.6,
          max_tokens: 300,
          stream: true,
        });

        let fullText = '';
        let firstChunk = true;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            if (firstChunk) {
              console.log(`[LOG] First chunk received in ${Date.now() - startTime}ms via ${activeModelId}`);
              firstChunk = false;
            }
            fullText += content;
            ws.send(JSON.stringify({ type: 'text_chunk', text: content }));
          }
        }

        messages.push({ role: 'assistant', content: fullText });
        console.log(`[LOG] Total request time: ${Date.now() - startTime}ms`);
        ws.send(JSON.stringify({ type: 'stream_end' }));
      }
    } catch (err) {
      console.error('[ERROR] Processing failed:', err);
      activeModelId = null;
      ws.send(JSON.stringify({
        type: 'error',
        message: 'חלה שגיאה בתקשורת. אנא נסה לשלוח שוב.'
      }));
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
