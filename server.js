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

const genAI = new GoogleGenerativeAI(apiKey || '');

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- תשובות קצרות, ממוקדות ומהירות בלבד (עד 2-3 משפטים לתגובה).
`;

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          systemInstruction: SYSTEM_INSTRUCTION
        });

        // הזרמת התשובה בזמן אמת (Streaming)
        const resultStream = await model.generateContentStream(message.text);

        for await (const chunk of resultStream.stream) {
          const chunkText = chunk.text();
          ws.send(JSON.stringify({
            type: 'text_chunk',
            text: chunkText
          }));
        }

        ws.send(JSON.stringify({ type: 'stream_end' }));
      }
    } catch (err) {
      console.error('Error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'שגיאה בעיבוד הבקשה'
      }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
