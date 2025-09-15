# QnAAIwaala - AI Interviewer Taker 🤖💼

**An intelligent interview platform that conducts domain-specific technical interviews using AI.**

## 📝 Description

QnAAIwaala is an AI-powered interview platform that conducts real-time technical interviews across various domains like NLP, Computer Vision, Diffusion Models, and more. It features voice interaction, anti-cheating mechanisms, and automated evaluation with detailed feedback.

## ✨ Key Features

### 🎯 Multi-Domain Interview Support

- **Domain Selection**: Choose from NLP, Computer Vision, Diffusion Models, and more
- **Dynamic Question Generation**: AI creates relevant questions based on selected domain
- **Adaptive Difficulty**: Questions adjust based on interview progress

### 🎤 Voice & Video Interaction

- **Text-to-Speech**: AI asks questions using natural voice
- **Speech-to-Text**: Convert user answers to text for evaluation
- **Video Recording**: Record interview sessions for analysis

### 🔒 Anti-Cheating Mechanisms

- **Tab Change Detection**: Monitor for suspicious browser activity
- **Video Monitoring**: Ensure interview integrity
- **Session Termination**: Automatic termination after 3 violations

### 📊 AI-Powered Evaluation

- **Automated Scoring**: AI evaluates answers and provides scores
- **Detailed Feedback**: Comprehensive suggestions for improvement
- **Email Reports**: Results sent directly to user's email

## 🛠️ Technology Stack

- **Frontend**: Next.js (TypeScript, TailwindCSS)
- **Backend**: FastAPI (Python)
- **State/DB**: In-memory for now (PostgreSQL planned; not required for local dev)
- **AI**: Gemini 2.0 Flash (primary), Groq LLMs (fallback); Hugging Face Inference API
- **TTS**: Groq PlayAI TTS (primary), HF ESPnet VITS (fallback)
- **STT**: Whisper (HF model `openai/whisper-large-v3` via Inference API)
- **Video**: WebRTC for recording (frontend)
- **Email**: SMTP (Gmail/SendGrid or any SMTP provider)

## 📋 Project Structure

```bash
QnAAIwaala/
├── frontend/          # Next.js application
├── backend/           # FastAPI application
├── README.md
└── road_map.txt
```

## 📋 Development Roadmap

1. **Phase 1**: Basic setup and user registration
2. **Phase 2**: AI question generation
3. **Phase 3**: Voice interaction (TTS/STT)
4. **Phase 4**: Anti-cheating mechanisms
5. **Phase 5**: Answer processing and evaluation
6. **Phase 6**: Result generation and email delivery
7. **Phase 7**: Advanced features and optimization

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+ (recommended)
- Git
- Optional: PostgreSQL (for future phases; not needed now)

### Installation

1. Clone the repository
2. Set up the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Set up the backend:

   ```bash
   cd backend
   # (optional) create & activate a virtual env
   python -m venv .venv
   source .venv/Scripts/activate  # on Git Bash/Windows
   # source .venv/bin/activate    # on macOS/Linux

   pip install -r requirements.txt

   # 1) From inside ./backend (recommended during dev):
   uvicorn main:app --reload --port 8000

   # 2) Or from repo root (alternative):
   # uvicorn backend.main:app --reload --port 8000
   ```

### Environment variables (backend)

Create a `.env` file inside `backend/` to enable AI services and optional email. Minimal example:

```env
# Groq (LLM + TTS)
GROQ_API_KEY=your_groq_api_key
# Optional: choose a Groq model (default: llama-3.1-8b-instant)
GROQ_LLM_MODEL=llama-3.1-8b-instant

# Hugging Face (fallback TTS + Whisper STT)
HUGGINGFACE_API_KEY=your_hf_api_key

# Gemini (primary for Q&A LLM)
GOOGLE_API_KEY=your_gemini_api_key
# Optional: choose a Gemini model (default: gemini-2.0-flash)
GEMINI_LLM_MODEL=gemini-2.0-flash

# Optional: SMTP for result emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=app_password_or_smtp_password
EMAIL_FROM=your_email@gmail.com
EMAIL_FROM_NAME=AI Interviewer
```

Notes:

- The API still works without keys; it will fall back to simple heuristics where possible.
- Email sending is attempted only when SMTP is configured and a user email is known.
- For question generation and evaluation, the backend tries Gemini first, then falls back to Groq.

### Run both apps

Open two terminals:

1) Backend (port 8000):

```bash
cd backend
uvicorn main:app --reload --port 8000
```

1) Frontend (port 3000):

```bash
cd frontend
npm install
npm run dev
```

The backend enables CORS for `http://localhost:3000` and `http://127.0.0.1:3000` by default.

## 🧭 API quick reference (backend)

- `GET /` → Health message: API running
- `GET /health` → Status and timestamp
- `GET /health/ai` → Presence of AI keys and configured models (no secrets)

Users & Sessions:

- `POST /api/users/register` → Register a user `{ name, email?, domain }`
- `POST /api/interview/generate-questions` → Query params: `domain`, `user_id`, optional `num_questions`, `duration_minutes`
- `GET /api/users/{user_id}/sessions` → List sessions for user

Interview flow:

- `POST /api/interview/submit-all` → Body: `{ session_id, answers: string[], questions?, domain?, send_email? }`
- `GET /api/interview/results/{session_id}` → Get computed results
- `GET /api/interview/generate-preamble` → Short, conversational preamble for next question

Voice & Anti-cheat:

- `POST /api/text-to-speech` → form-data: `text`, optional `voice`, `response_format` (`wav`|`mp3`)
- `POST /api/speech-to-text` → form-data file: `audio_file`
- `POST /api/cheat-detection` → JSON: `{ session_id, event_type, timestamp, confidence }`
- `POST /api/analyze-frame` → form-data: `image_data` (base64), `session_id`

Response shapes are documented inline in the backend code under `backend/main.py` and `backend/ai_services.py`.

## 🔧 Troubleshooting

- CORS: If you access the frontend from a different origin/port, add it in `backend/main.py` under `allow_origins`.
- Ports: Default frontend runs on `3000`, backend on `8000`. Adjust `uvicorn` `--port` if needed.
- Dependencies: Installing `torch` on Windows can take time; ensure Python 3.10+ and sufficient disk space.
- Optional modules: Cheat detection falls back to disabled mode if OpenCV/MediaPipe are unavailable; the API responds with a clear message.

## 📄 License

MIT License
