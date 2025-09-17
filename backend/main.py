from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from dotenv import load_dotenv
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Optional service imports (keep endpoints loadable even if services missing)
try:
    from ai_services import ai_service  # type: ignore
except Exception:
    ai_service = None  # type: ignore

try:
    from cheat_detection import cheat_detector  # type: ignore
    CHEAT_DETECTION_TYPE = "advanced"
except Exception:
    try:
        from cheat_detection_lite import lightweight_cheat_detector as cheat_detector  # type: ignore
        CHEAT_DETECTION_TYPE = "lightweight"
    except Exception:
        cheat_detector = None  # type: ignore
        CHEAT_DETECTION_TYPE = "disabled"

# Env
load_dotenv()

# App
app = FastAPI(title="AI Interviewer API", version="2.0.0")

# CORS: allow localhost for dev, plus optional env-configured origins and a regex for Vercel by default
default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
extra_origins_env = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
extra_origins = [o.strip() for o in extra_origins_env.split(",") if o.strip()] if extra_origins_env else []

# You can override this via CORS_ALLOW_ORIGIN_REGEX. By default, allow any https://*.vercel.app
allow_origin_regex = os.getenv("CORS_ALLOW_ORIGIN_REGEX", r"https://.*\.vercel\.app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=default_origins + extra_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class UserRegistration(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    domain: str


class QuestionRequest(BaseModel):
    session_id: str
    domain: str
    difficulty: str = "intermediate"


class CheatDetectionEvent(BaseModel):
    session_id: str
    event_type: str
    timestamp: str
    confidence: float


class SubmitAllRequest(BaseModel):
    session_id: str
    answers: list[str]
    # Optional recovery fields when backend lost in-memory session (e.g., after reload)
    questions: Optional[list[str]] = None
    domain: Optional[str] = None
    # Optional: whether to email results to the registered user
    send_email: Optional[bool] = None


# In-memory stores
users_db: dict = {}
sessions_db: dict = {}
results_db: dict = {}
cheat_events: dict = {}

# Domain questions (kept small and simple)
DOMAIN_QUESTIONS = {
    "web-dev": [
        "Explain the difference between REST and GraphQL APIs.",
        "What are the security considerations in web development?",
        "How do you optimize web application performance?",
    ],
    "ml": [
        "What is the bias-variance tradeoff?",
        "Explain cross-validation and its types.",
        "How do you handle overfitting in machine learning?",
    ],
    "nlp": [
        "What is the difference between stemming and lemmatization?",
        "Explain how transformers handle long-range dependencies.",
        "How would you fine-tune a language model for question answering?",
    ],
    "cv": [
        "Explain the difference between CNNs and Vision Transformers.",
        "What data augmentations help most in image classification?",
        "How does non-maximum suppression (NMS) work in object detection?",
    ],
    "diffusion": [
        "What is the forward and reverse process in diffusion models?",
        "How do CLIP guidance and classifier-free guidance differ?",
        "Describe how you would fine-tune a Stable Diffusion model for a new style.",
    ],
    "dl": [
        "What problems do residual connections solve?",
        "Compare batch normalization and layer normalization.",
        "When would you use LSTMs vs. Transformers?",
    ],
    "rl": [
        "Differentiate on-policy and off-policy learning with examples.",
        "What is the role of the value function in actor-critic methods?",
        "How would you handle sparse rewards in RL?",
    ],
    "data-science": [
        "How do you handle missing data and why choose a method?",
        "Explain feature leakage and how to detect/prevent it.",
        "What steps form a robust cross-validation strategy?",
    ],
}


# ----------------------
# Email utilities
# ----------------------
def _build_result_email_content(result: dict, user: Optional[dict]) -> tuple[str, str]:
    """Return (plain_text, html) bodies for the results email."""
    user_name = (user or {}).get("name") or "Candidate"
    domain = result.get("domain", "unknown")
    total_score = result.get("total_score", 0)
    unanswered = result.get("unanswered_count", 0)
    responses = result.get("responses", [])

    # Plain text
    lines = [
        f"Hello {user_name},",
        "",
        f"Here are your interview results for the {domain} domain:",
        f"Total Score: {total_score}",
        f"Unanswered Questions: {unanswered}",
        "",
        "Per-question feedback:",
    ]
    for r in responses:
        q = r.get("question", "")
        a = r.get("answer", "") or "(no answer)"
        score = r.get("score", 0)
        feedback = r.get("feedback", "")
        # Truncate very long answers for email brevity
        a_short = (a[:300] + "…") if len(a) > 300 else a
        lines.append("- Question: " + q)
        lines.append(f"  Score: {score}")
        if feedback:
            lines.append(f"  Feedback: {feedback}")
        lines.append("  Your answer: " + a_short)
        lines.append("")

    lines.extend([
        "Thank you for participating.",
        "",
        "— AI Interviewer",
    ])
    plain = "\n".join(lines)

    # HTML (very simple)
    html_parts = [
        f"<p>Hello {user_name},</p>",
        f"<p>Here are your interview results for the <strong>{domain}</strong> domain.</p>",
        f"<p><strong>Total Score:</strong> {total_score}<br><strong>Unanswered Questions:</strong> {unanswered}</p>",
        "<h3>Per-question feedback</h3>",
        "<ol>",
    ]
    for r in responses:
        q = r.get("question", "")
        a = r.get("answer", "") or "(no answer)"
        score = r.get("score", 0)
        feedback = r.get("feedback", "")
        a_short = (a[:600] + "…") if len(a) > 600 else a
        html_parts.append("<li>")
        html_parts.append(f"<p><strong>Question:</strong> {q}<br><strong>Score:</strong> {score}</p>")
        if feedback:
            html_parts.append(f"<p><strong>Feedback:</strong> {feedback}</p>")
        html_parts.append(f"<p><strong>Your answer:</strong> {a_short}</p>")
        html_parts.append("</li>")
    html_parts.extend([
        "</ol>",
        "<p>Thank you for participating.</p>",
        "<p>— AI Interviewer</p>",
    ])
    html = "".join(html_parts)
    return plain, html


def send_results_email(to_email: str, subject: str, plain_body: str, html_body: Optional[str] = None) -> None:
    """Send an email via SMTP using env configuration. Runs in background task.

    Uses MIMEMultipart('alternative') to include both plain text and HTML bodies.
    """
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "0") or 0)
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASSWORD", "")
    from_email = smtp_user or os.getenv("EMAIL_FROM", "")
    from_name = os.getenv("EMAIL_FROM_NAME", "AI Interviewer")

    if not (smtp_host and smtp_port and from_email):
        # Misconfigured; skip silently
        print("[email] SMTP not configured; skipping send")
        return

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = f"{from_name} <{from_email}>" if from_name else from_email
    msg['To'] = to_email

    # Attach plain and HTML parts (plain first as fallback)
    msg.attach(MIMEText(plain_body or "", 'plain', 'utf-8'))
    if html_body:
        msg.attach(MIMEText(html_body, 'html', 'utf-8'))

    try:
        # Use STARTTLS by default (Gmail: smtp.gmail.com:587)
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            try:
                server.starttls(context=context)
                server.ehlo()
            except Exception:
                # If STARTTLS fails (e.g., server expects SSL on connect), try SSL
                server.close()
                ssl_port = 465 if smtp_port == 587 else smtp_port
                with smtplib.SMTP_SSL(smtp_host, ssl_port, context=context) as s2:
                    if smtp_user and smtp_pass:
                        s2.login(smtp_user, smtp_pass)
                    s2.sendmail(from_email, [to_email], msg.as_string())
                    return
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, [to_email], msg.as_string())
    except Exception as e:
        # Log but do not raise to avoid affecting API response
        print(f"[email] Failed to send email to {to_email}: {e}")


# Basic endpoints
@app.get("/")
async def root():
    return {"message": "AI Interviewer API is running!"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/health/ai")
async def health_ai():
    """Report presence of AI keys and configured models (no secrets exposed)."""
    status = {
        "provider_available": ai_service is not None,
        "timestamp": datetime.now().isoformat(),
    }
    if ai_service is not None:
        try:
            groq_ok = bool(getattr(ai_service, "groq_api_key", None))
            hf_ok = bool(getattr(ai_service, "hf_api_key", None))
            gem_ok = bool(getattr(ai_service, "gemini_api_key", None))
            status.update({
                "groq_key_present": groq_ok,
                "hf_key_present": hf_ok,
                "gemini_key_present": gem_ok,
                "tts_model": getattr(ai_service, "tts_model_groq", None),
                "tts_voice_default": getattr(ai_service, "tts_voice_groq", None),
                "stt_model": getattr(ai_service, "stt_model", None),
                "llm_model": getattr(ai_service, "llm_model", None),
                "gemini_model": getattr(ai_service, "gemini_model", None),
            })
        except Exception as e:
            status["error"] = str(e)
    return status


# Users
@app.post("/api/users/register")
async def register_user(user: UserRegistration):
    user_id = f"user_{len(users_db) + 1}"
    users_db[user_id] = {
        "id": user_id,
        "name": user.name,
        "email": user.email,
        "domain": user.domain,
        "created_at": datetime.now(),
    }
    return {"message": "User registered successfully", "user_id": user_id, "status": "success"}


# Sessions / Questions
@app.post("/api/interview/generate-questions")
async def generate_questions(domain: str, user_id: str, num_questions: int | None = None, duration_minutes: int | None = None):
    """Generate questions via AI when available (Gemini primary, Groq fallback), else use built-ins."""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    questions: list[str] = []
    # Prefer AI generation if available
    if ai_service is not None and hasattr(ai_service, "generate_question"):
        try:
            count = num_questions if (num_questions and num_questions > 0) else 3
            prev: list[str] = []
            for _ in range(count):
                res = await ai_service.generate_question(domain, previous_questions=prev)  # type: ignore
                if res.get("success") and res.get("question"):
                    q = str(res["question"]).strip()
                    if q:
                        questions.append(q)
                        prev.append(q)
                else:
                    # Stop AI loop on error and fallback below
                    print(f"[AI] Question generation via AI failed: {res.get('error')}")
                    questions = []
                    break
        except Exception as e:
            print(f"[AI] Error generating questions via AI: {e}")
            questions = []

    # Fallback to built-in domain list if AI unavailable or failed
    if not questions:
        if domain not in DOMAIN_QUESTIONS:
            raise HTTPException(status_code=400, detail=f"Domain '{domain}' not supported and AI unavailable")
        all_qs = DOMAIN_QUESTIONS[domain]
        if num_questions is None or num_questions <= 0:
            questions = all_qs
            num_questions = len(all_qs)
        else:
            if num_questions <= len(all_qs):
                questions = all_qs[: num_questions]
            else:
                questions = [all_qs[i % len(all_qs)] for i in range(num_questions)]
    else:
        # If AI succeeded, ensure num_questions reflects actual count
        num_questions = len(questions)

    # Clamp/normalize duration
    if duration_minutes is not None and duration_minutes <= 0:
        duration_minutes = None

    session_id = f"session_{len(sessions_db) + 1}"
    sessions_db[session_id] = {
        "id": session_id,
        "user_id": user_id,
        "domain": domain,
        "questions": questions,
        "current_question": 0,
        "responses": [],
        "created_at": datetime.now(),
        "status": "active",
        "duration_minutes": duration_minutes,
        "num_questions": num_questions,
    }
    return {
        "session_id": session_id,
        "questions": questions,
        "total_questions": len(questions),
        "domain": domain,
        "duration_minutes": duration_minutes,
        "num_questions": num_questions,
    }


@app.post("/api/interview/submit-answer")
async def submit_answer(session_id: str, question_index: int, answer: str):
    return {"message": "Answer received", "session_id": session_id, "question_index": question_index}


@app.post("/api/interview/submit-all")
async def submit_all(payload: SubmitAllRequest, background_tasks: BackgroundTasks):
    # Recover session if missing and client provided enough info
    if payload.session_id not in sessions_db:
        if payload.questions and payload.domain:
            sessions_db[payload.session_id] = {
                "id": payload.session_id,
                "user_id": "unknown",
                "domain": payload.domain,
                "questions": payload.questions,
                "current_question": 0,
                "responses": [],
                "created_at": datetime.now(),
                "status": "active",
            }
        else:
            raise HTTPException(status_code=404, detail="Session not found")

    session = sessions_db[payload.session_id]
    questions = session.get("questions", []) or payload.questions or []
    if not isinstance(payload.answers, list) or len(payload.answers) != len(questions):
        raise HTTPException(status_code=400, detail="Answers array must match questions length")

    # Evaluate answers: prefer Gemini primary, fallback to Groq via ai_service.evaluate_answer; else heuristic
    responses = []
    for i, (q, a) in enumerate(zip(questions, payload.answers)):
        score = 0.0
        feedback = ""
        strengths = []
        improvements = []
        # Penalize unanswered (blank) answers as negative points
        if not a or not a.strip():
            responses.append({
                "question_index": i,
                "question": q,
                "answer": a,
                "score": -1.0,
                "feedback": "Unanswered",
                "strengths": strengths,
                "improvements": ["Provide at least a brief attempt"] or improvements,
            })
            continue
        if ai_service is not None and hasattr(ai_service, "evaluate_answer"):
            try:
                result = await ai_service.evaluate_answer(q, a or "", session.get("domain", ""))  # type: ignore
                if result.get("success"):
                    score = float(result.get("score", 0.0))
                    feedback = str(result.get("feedback", ""))
                    strengths = result.get("strengths", []) or []
                    improvements = result.get("improvements", []) or []
                else:
                    # Fall back to heuristic if evaluator returned an error
                    length = len((a or "").split())
                    score = max(1.0, min(10.0, length / 10.0 * 3.0 + 4.0))
                    feedback = str(result.get("error", "Evaluation failed")) + " (auto-scored by heuristic)"
            except Exception as e:
                # Fall back to heuristic on exception
                length = len((a or "").split())
                score = max(1.0, min(10.0, length / 10.0 * 3.0 + 4.0))
                feedback = f"Evaluation error: {e} (auto-scored by heuristic)"
        else:
            # Simple heuristic if evaluator unavailable
            length = len((a or "").split())
            score = max(1.0, min(10.0, length / 10.0 * 3.0 + 4.0))  # rough 4-10 based on length
            feedback = "Auto-scored by heuristic (LLM unavailable)."  
            strengths = ["Answered the question"] if length > 0 else ["Attempted"]
            improvements = ["Provide more details and structure"]

        responses.append({
            "question_index": i,
            "question": q,
            "answer": a,
            "score": round(score, 2),
            "feedback": feedback,
            "strengths": strengths,
            "improvements": improvements,
        })

    # Save into session and results
    session["responses"] = responses
    total_score = sum(r["score"] for r in responses) / len(responses) if responses else 0.0
    result = {
        "session_id": payload.session_id,
        "domain": session.get("domain"),
        "total_score": round(total_score, 2),
        "responses": responses,
        "completed_at": datetime.now().isoformat(),
        "duration_minutes": session.get("duration_minutes"),
        "unanswered_count": sum(1 for r in responses if r.get("score") == -1.0),
    }
    results_db[payload.session_id] = result
    session["status"] = "completed"

    # Attempt to email results if enabled, SMTP is configured, and user is known
    user = None
    try:
        uid = session.get("user_id")
        if uid and uid in users_db and uid != "unknown":
            user = users_db[uid]
    except Exception:
        user = None

    try:
        # Decide default: if client didn't send a flag, default to True only when SMTP is present
        want_email = payload.send_email
        if want_email is None:
            smtp_present = bool(os.getenv("SMTP_HOST")) and bool(os.getenv("SMTP_PORT"))
            want_email = bool(smtp_present and user and user.get("email"))

        if want_email and user and user.get("email"):
            subject = f"Your Interview Results — {result.get('domain', 'Interview')}"
            plain, html = _build_result_email_content(result, user)
            background_tasks.add_task(
                send_results_email,
                user["email"],
                subject,
                plain,
                html,
            )
    except Exception as e:
        # Log but continue
        print(f"[email] Scheduling email failed: {e}")

    return {"message": "Interview submitted", "result": result}

@app.post("/api/interview/complete")
async def complete_interview(session_id: str):
    if session_id not in sessions_db:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions_db[session_id]
    user = users_db[session["user_id"]]
    responses = session.get("responses", [])
    total_score = sum(r["score"] for r in responses) / len(responses) if responses else 0.0

    feedback = f"Interview completed for {session['domain']} domain. "
    feedback += "Overall performance: " + ("Excellent" if total_score >= 8 else "Good" if total_score >= 6 else "Needs Improvement")

    suggestions = [
        "Practice more technical questions in your domain",
        "Work on providing more detailed explanations",
        "Consider real-world examples in your answers",
    ]

    result = {
        "session_id": session_id,
        "user_email": user["email"],
        "user_name": user["name"],
        "domain": session["domain"],
        "total_score": round(total_score, 2),
        "detailed_feedback": feedback,
        "suggestions": suggestions,
        "responses": responses,
        "completed_at": datetime.now(),
    }

    results_db[session_id] = result
    session["status"] = "completed"
    return {"message": "Interview completed successfully", "result": result}


@app.get("/api/interview/results/{session_id}")
async def get_results(session_id: str):
    if session_id not in results_db:
        raise HTTPException(status_code=404, detail="Results not found")
    return results_db[session_id]


@app.get("/api/users/{user_id}/sessions")
async def get_user_sessions(user_id: str):
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    user_sessions = [s for s in sessions_db.values() if s["user_id"] == user_id]
    return {"sessions": user_sessions}


@app.post("/api/text-to-speech")
async def text_to_speech(text: str = Form(...), voice: Optional[str] = Form(None), response_format: Optional[str] = Form(None)):
    if ai_service is None:
        raise HTTPException(status_code=500, detail="AI service not available")
    # Use Groq TTS by default as requested
    result = await ai_service.text_to_speech_groq(text, voice=voice, response_format=response_format)  # type: ignore
    if result.get("success"):
        return result
    # Fallback to HF TTS if Groq fails
    try:
        hf = await ai_service.text_to_speech_hf(text)  # type: ignore
        if hf.get("success"):
            hf["note"] = f"Groq TTS failed; fallback used. Groq error: {result.get('error')}"
            return hf
    except Exception as e:
        # ignore and raise below
        result["fallback_error"] = str(e)
    raise HTTPException(status_code=500, detail=result.get("error", "TTS failed"))


@app.post("/api/speech-to-text")
async def speech_to_text(audio_file: UploadFile = File(...)):
    if ai_service is None:
        raise HTTPException(status_code=500, detail="AI service not available")
    audio_data = await audio_file.read()
    content_type = audio_file.content_type or "audio/wav"
    result = await ai_service.speech_to_text_hf(audio_data, content_type=content_type)  # type: ignore
    if result.get("success"):
        return result
    raise HTTPException(status_code=500, detail=result.get("error", "STT failed"))


@app.post("/api/cheat-detection")
async def report_cheat_event(event: CheatDetectionEvent):
    if event.session_id not in sessions_db:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions_db[event.session_id]
    session["cheat_count"] = session.get("cheat_count", 0) + 1
    cheat_events.setdefault(event.session_id, []).append(event.dict())

    if session["cheat_count"] >= 3:
        session["status"] = "terminated"
        return {
            "status": "terminated",
            "message": "Interview terminated due to suspicious activity",
            "cheat_count": session["cheat_count"],
        }

    return {
        "status": "warning",
        "message": f"Cheat detection warning. Count: {session['cheat_count']}/3",
        "cheat_count": session["cheat_count"],
    }


@app.post("/api/analyze-frame")
async def analyze_frame(image_data: str = Form(...), session_id: str = Form(...)):
    if session_id not in sessions_db:
        raise HTTPException(status_code=404, detail="Session not found")

    if cheat_detector is None:
        return {
            "error": "Cheat detection not available (OpenCV not installed)",
            "suspicious_activity": False,
            "confidence": 0.0,
            "details": {"cheat_detection_disabled": True},
        }

    analysis_result = cheat_detector.analyze_frame(image_data)  # type: ignore
    analysis_result["session_id"] = session_id
    analysis_result["timestamp"] = datetime.now().isoformat()
    analysis_result["detection_type"] = CHEAT_DETECTION_TYPE
    return analysis_result


@app.get("/api/interview/generate-preamble")
async def generate_preamble(session_id: Optional[str] = None, name: Optional[str] = None, question_index: int = 0, total_questions: int = 1, domain: Optional[str] = None):
    """Return a short, conversational preamble for the next question.
    If Groq is unavailable, fallback to simple templates.
    """
    # Load question context optionally from session
    if session_id and session_id in sessions_db:
        s = sessions_db[session_id]
        if domain is None:
            domain = s.get("domain")
        if not name and s.get("user_id") in users_db:
            name = users_db[s["user_id"]].get("name")

    def fallback_preamble(nm: Optional[str], idx: int, total: int, dom: Optional[str]) -> str:
        nm2 = nm or "there"
        pos = "first" if idx == 0 else ("last" if idx == total - 1 else "next")
        if pos == "first":
            return f"Hello {nm2}, let's get started with your interview{(' in ' + dom) if dom else ''}. Here's the first question:"
        if pos == "last":
            return f"Great going {nm2}! You've come this far—here's the last, but not the least, question:"
        return f"Nice progress {nm2}. Let's keep the momentum—here's the next question:"

    if ai_service is not None and hasattr(ai_service, "generate_preamble_with_groq"):
        try:
            res = await ai_service.generate_preamble_with_groq(name, "", question_index, total_questions, domain)  # type: ignore
            if res.get("success"):
                return {"preamble": res.get("preamble")}
        except Exception:
            pass
    # Fallback
    return {"preamble": fallback_preamble(name, question_index, total_questions, domain)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)