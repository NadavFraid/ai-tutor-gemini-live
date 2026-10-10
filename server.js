const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

wss.on('connection', (clientWs) => {
  console.log('[LOG] Client connected to local WebSocket');

  if (!API_KEY) {
    console.error('[ERROR] GEMINI_API_KEY is missing');
    clientWs.send(JSON.stringify({ type: 'error', message: 'חסר GEMINI_API_KEY בשרת' }));
    return;
  }

  // התחברות ל-Gemini Multimodal Live API WebSocket
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
  const geminiWs = new WebSocket(geminiWsUrl);

  geminiWs.on('open', () => {
    console.log('[LOG] Connected to Gemini Multimodal Live API');

    // שליחת הודעת הגדרה ראשונית (Setup Message)
    const setupMsg = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
        generationConfig: {
          responseModalities: ['AUDIO', 'TEXT'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck' // קול זכר טבעי וברור
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        }
      }
    };
    geminiWs.send(JSON.stringify(setupMsg));
  });

  // העברת הודעות מ-Gemini אל הלקוח
  geminiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());
      
      // טיפול בתשובת אודיו/טקסט מ-Gemini
      if (response.serverContent && response.serverContent.modelTurn) {
        const parts = response.serverContent.modelTurn.parts || [];
        for (const part of parts) {
          if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
            clientWs.send(JSON.stringify({
              type: 'audio_chunk',
              data: part.inlineData.data
            }));
          }
          if (part.text) {
            clientWs.send(JSON.stringify({
              type: 'text_chunk',
              text: part.text
            }));
          }
        }
      }

      if (response.serverContent && response.serverContent.turnComplete) {
        clientWs.send(JSON.stringify({ type: 'turn_complete' }));
      }
    } catch (e) {
      console.error('[ERROR] Parsing Gemini response:', e);
    }
  });

  // העברת נתונים מהלקוח (מיקרופון/מצלמה) אל Gemini
  clientWs.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);

      if (geminiWs.readyState === WebSocket.OPEN) {
        if (parsed.type === 'realtime_input') {
          // העברת פריימים של אודיו/וידאו בלייב ל-Gemini
          const realtimeMsg = {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: parsed.mimeType,
                  data: parsed.data
                }
              ]
            }
          };
          geminiWs.send(JSON.stringify(realtimeMsg));
        } else if (parsed.type === 'text_input') {
          const clientContentMsg = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{ text: parsed.text }]
                }
              ],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(clientContentMsg));
        }
      }
    } catch (e) {
      console.error('[ERROR] Handling client message:', e);
    }
  });

  geminiWs.on('error', (err) => {
    console.error('[ERROR] Gemini WS Error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', message: 'תקלה בתקשורת מול Gemini Live' }));
  });

  clientWs.on('close', () => {
    console.log('[LOG] Client disconnected');
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
