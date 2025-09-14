import cv2
import mediapipe as mp
import time
import math

mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

# Initialize FaceMesh
face_mesh = mp_face_mesh.FaceMesh(refine_landmarks=True, max_num_faces=1)
cap = cv2.VideoCapture(0)

counter = 0
looking_away_start = None
AWAY_THRESHOLD_SEC = 3

def is_looking_forward(landmarks, w, h):
    # Use eye and nose landmarks to check head orientation
    left_eye = landmarks[33]   # right eye
    right_eye = landmarks[263] # left eye
    nose_tip = landmarks[1]    # nose

    # Convert normalized coords to pixels
    lx, ly = int(left_eye.x * w), int(left_eye.y * h)
    rx, ry = int(right_eye.x * w), int(right_eye.y * h)
    nx, ny = int(nose_tip.x * w), int(nose_tip.y * h)

    # Simple heuristic: check if nose is roughly centered between eyes
    mid_x = (lx + rx) / 2
    if abs(nx - mid_x) > 60:  # threshold in pixels (tuneable)
        return False
    return True

while True:
    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb_frame)

    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            if is_looking_forward(face_landmarks.landmark, w, h):
                # Reset timer if looking at screen
                looking_away_start = None
                cv2.putText(frame, "Looking at Screen", (30, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            else:
                cv2.putText(frame, "Not Looking!", (30, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                if looking_away_start is None:
                    looking_away_start = time.time()
                else:
                    elapsed = time.time() - looking_away_start
                    if elapsed >= AWAY_THRESHOLD_SEC:
                        counter += 1
                        print(f"⚠️ Counter increased: {counter}")
                        looking_away_start = None  # reset timer

    cv2.putText(frame, f"Counter: {counter}", (30, 70),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)

    cv2.imshow("Face Mesh - Screen Attention", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
