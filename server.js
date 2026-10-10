const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not defined in environment variables!");
}

const genAI = new GoogleGenerativeAI(apiKey || '');

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

let activeModelName = null;

// פונקציה לזיהוי אקטיבי של המודל הזמין ב-API Key
async function discoverWorkingModel() {
  try {
    console.log('[LOG] Fetching available models from Google API...');
    // ניסיון ראשון: בדיקה מול מודלים נפוצים
    const testCandidates = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    
    for (const candidate of testCandidates) {
      try {
        const testModel = genAI.getGenerativeModel({ model: candidate });
        await testModel.generateContent('ping');
        console.log(`[SUCCESS] Found working model: ${candidate}`);
        return candidate;
      } catch (e) {
        console.log(`[LOG] Model ${candidate} not available (${e.status || e.message})`);
      }
    }
  } catch (err) {
    console.error('[ERROR] Model discovery failed:', err);
  }
  
  // ברירת מחדל במידה ולא נמצע במבחן המהיר
  return 'gemini-2.0-flash';
}

// זיהוי המודל בעת עליית השרת
discoverWorkingModel().then(name => {
  activeModelName = name;
  console.log(`[SERVER READY] Using active model: ${activeModelName}`);
});

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected via WebSocket');
  const history = [];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const message = JSON.parse(data);

      if (!activeModelName) {
        activeModelName = await discoverWorkingModel();
      }

      console.log(`[LOG] Using model ${activeModelName} for query: "${message.text}"`);

      const model = genAI.getGenerativeModel({
        model: activeModelName,
        systemInstruction: SYSTEM_INSTRUCTION
      });

      history.push({ role: 'user', parts: [{ text: message.text }] });

      const resultStream = await model.generateContentStream({ contents: history });

      let fullModelResponse = '';
      let firstChunk = true;

      for await (const chunk of resultStream.stream) {
        if (firstChunk) {
          console.log(`[LOG] First chunk received in ${Date.now() - startTime}ms`);
          firstChunk = false;
        }
        const chunkText = chunk.text();
        fullModelResponse += chunkText;
        ws.send(JSON.stringify({ type: 'text_chunk', text: chunkText }));
      }

      history.push({ role: 'model', parts: [{ text: fullModelResponse }] });
      ws.send(JSON.stringify({ type: 'stream_end' }));

    } catch (err) {
      console.error('[ERROR] Request failed:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאה בתקשורת: ${err.message}`
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
