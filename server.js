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
- ענה בקצרה ובמהירות (1-2 משפטים בלבד בכל תגובה).
`;

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  // שמירת היסטוריית השיחה באופן מקומי לכל התחברות
  const history = [];

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        const model = genAI.getGenerativeModel({
          model: 'gemini-3.8-flash',
          systemInstruction: SYSTEM_INSTRUCTION
        });

        // הוספת הודעת המשתמש להיסטוריה
        history.push({ role: 'user', parts: [{ text: message.text }] });

        // שליחת כל היסטוריית השיחה כתוכן לבקשה
        const resultStream = await model.generateContentStream({
          contents: history
        });

        let fullModelResponse = '';

        for await (const chunk of resultStream.stream) {
          const chunkText = chunk.text();
          fullModelResponse += chunkText;
          ws.send(JSON.stringify({
            type: 'text_chunk',
            text: chunkText
          }));
        }

        // שמירת תשובת המודל בהיסטוריה
        history.push({ role: 'model', parts: [{ text: fullModelResponse }] });

        ws.send(JSON.stringify({ type: 'stream_end' }));
      }
    } catch (err) {
      console.error('Error during streaming:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאה: ${err.message || 'חל עיכוב בתגובה, נסה שוב'}`
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
