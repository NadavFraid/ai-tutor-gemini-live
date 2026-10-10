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

let activeModelId = null;

// שליפת מודל זמין בזמן אמת דרך ה-API של Groq
async function getAvailableGroqModel() {
  try {
    const modelsList = await groq.models.list();
    if (modelsList && modelsList.data && modelsList.data.length > 0) {
      // ניסיון למצוא מודל Llama, GPT, או Qwen פעיל
      const preferred = modelsList.data.find(m => 
        m.id.includes('llama') || m.id.includes('gpt-oss') || m.id.includes('qwen')
      );
      const selectedModel = preferred ? preferred.id : modelsList.data[0].id;
      console.log(`[LOG] Automatically selected active Groq model: ${selectedModel}`);
      return selectedModel;
    }
  } catch (err) {
    console.error('[ERROR] Failed to fetch active models from Groq:', err.message);
  }
  return 'openai/gpt-oss-20b'; // ברירת מחדל נתמכת ב-Groq
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

        // זיהוי דינמי אם עדיין לא נבחר מודל
        if (!activeModelId) {
          activeModelId = await getAvailableGroqModel();
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
      // איפוס המודל למקרה של תקלה זמנית מול מודל מסוים
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
