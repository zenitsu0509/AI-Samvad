import cv2
import mediapipe as mp
import numpy as np
from typing import Dict, Tuple, List
import base64
from PIL import Image
import io

class CheatDetectionService:
    """Computer vision service for real-time cheat detection during interviews"""
    
    def __init__(self):
        # Initialize MediaPipe components
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_hands = mp.solutions.hands
        self.mp_pose = mp.solutions.pose
        
        # Initialize detectors
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=0.5
        )
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.5
        )
        
        # Thresholds and configuration
        self.gaze_threshold = 0.3  # Threshold for detecting looking away
        self.phone_detection_threshold = 0.7
        self.movement_threshold = 50  # Pixel threshold for unusual movement
        
        # Previous frame data for comparison
        self.prev_landmarks = None
        self.frame_count = 0
        
    def analyze_frame(self, image_data: str) -> Dict:
        """
        Analyze a single frame for suspicious activities
        
        Args:
            image_data: Base64 encoded image string
            
        Returns:
            Dictionary with analysis results
        """
        try:
            # Decode base64 image
            if ',' in image_data:
                image_data = image_data.split(',')[1]
            
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
            frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            
            # Initialize results
            results = {
                "suspicious_activity": False,
                "confidence": 0.0,
                "details": {
                    "face_detected": False,
                    "looking_away": False,
                    "multiple_faces": False,
                    "hands_near_face": False,
                    "unusual_movement": False,
                    "poor_lighting": False
                },
                "violations": []
            }
            
            # Convert BGR to RGB for MediaPipe
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Face detection
            face_results = self.face_detection.process(rgb_frame)
            face_count = 0
            
            if face_results.detections:
                face_count = len(face_results.detections)
                results["details"]["face_detected"] = True
                
                if face_count > 1:
                    results["details"]["multiple_faces"] = True
                    results["violations"].append("Multiple faces detected")
                    results["suspicious_activity"] = True
            else:
                results["violations"].append("No face detected")
                results["suspicious_activity"] = True
            
            # Gaze tracking using face mesh
            if results["details"]["face_detected"]:
                gaze_away = self._analyze_gaze(rgb_frame)
                if gaze_away:
                    results["details"]["looking_away"] = True
                    results["violations"].append("Looking away from camera")
                    results["suspicious_activity"] = True
            
            # Hand detection
            hand_results = self.hands.process(rgb_frame)
            if hand_results.multi_hand_landmarks:
                hands_near_face = self._check_hands_near_face(
                    hand_results.multi_hand_landmarks, 
                    face_results.detections if face_results.detections else []
                )
                if hands_near_face:
                    results["details"]["hands_near_face"] = True
                    results["violations"].append("Hands detected near face")
                    results["suspicious_activity"] = True
            
            # Movement analysis
            if self.frame_count > 0:  # Skip first frame
                unusual_movement = self._detect_unusual_movement(rgb_frame)
                if unusual_movement:
                    results["details"]["unusual_movement"] = True
                    results["violations"].append("Unusual movement detected")
                    results["suspicious_activity"] = True
            
            # Lighting analysis
            poor_lighting = self._analyze_lighting(frame)
            if poor_lighting:
                results["details"]["poor_lighting"] = True
                results["violations"].append("Poor lighting conditions")
            
            # Calculate overall confidence
            violation_count = len([v for v in results["details"].values() if v])
            total_checks = len(results["details"])
            results["confidence"] = min(1.0, violation_count / total_checks)
            
            self.frame_count += 1
            return results
            
        except Exception as e:
            return {
                "error": f"Frame analysis failed: {str(e)}",
                "suspicious_activity": False,
                "confidence": 0.0
            }
    
    def _analyze_gaze(self, frame: np.ndarray) -> bool:
        """Analyze gaze direction to detect looking away"""
        try:
            face_mesh_results = self.face_mesh.process(frame)
            
            if not face_mesh_results.multi_face_landmarks:
                return True  # No face detected = suspicious
            
            landmarks = face_mesh_results.multi_face_landmarks[0]
            
            # Get eye landmarks for gaze estimation
            left_eye_landmarks = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
            right_eye_landmarks = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
            
            # Simple gaze estimation based on iris position relative to eye corners
            # This is a simplified approach - more sophisticated methods exist
            
            # For now, return False (not looking away) as placeholder
            # TODO: Implement proper gaze tracking algorithm
            return False
            
        except Exception:
            return False
    
    def _check_hands_near_face(self, hand_landmarks_list: List, face_detections: List) -> bool:
        """Check if hands are near the face (potential cheating)"""
        try:
            if not face_detections or not hand_landmarks_list:
                return False
            
            # Get face bounding box
            face_detection = face_detections[0]
            face_bbox = face_detection.location_data.relative_bounding_box
            
            # Check each hand
            for hand_landmarks in hand_landmarks_list:
                # Get hand center point
                hand_points = [(lm.x, lm.y) for lm in hand_landmarks.landmark]
                hand_center_x = sum(p[0] for p in hand_points) / len(hand_points)
                hand_center_y = sum(p[1] for p in hand_points) / len(hand_points)
                
                # Check if hand is within expanded face region
                face_margin = 0.2  # 20% margin around face
                if (face_bbox.xmin - face_margin <= hand_center_x <= face_bbox.xmin + face_bbox.width + face_margin and
                    face_bbox.ymin - face_margin <= hand_center_y <= face_bbox.ymin + face_bbox.height + face_margin):
                    return True
            
            return False
            
        except Exception:
            return False
    
    def _detect_unusual_movement(self, frame: np.ndarray) -> bool:
        """Detect unusual movement patterns"""
        try:
            if self.prev_landmarks is None:
                pose_results = self.pose.process(frame)
                if pose_results.pose_landmarks:
                    self.prev_landmarks = [(lm.x, lm.y) for lm in pose_results.pose_landmarks.landmark]
                return False
            
            pose_results = self.pose.process(frame)
            if not pose_results.pose_landmarks:
                return False
            
            current_landmarks = [(lm.x, lm.y) for lm in pose_results.pose_landmarks.landmark]
            
            # Calculate movement magnitude
            total_movement = 0
            for prev, curr in zip(self.prev_landmarks, current_landmarks):
                movement = np.sqrt((curr[0] - prev[0])**2 + (curr[1] - prev[1])**2)
                total_movement += movement
            
            avg_movement = total_movement / len(current_landmarks)
            self.prev_landmarks = current_landmarks
            
            # Threshold for unusual movement (normalized)
            return avg_movement > self.movement_threshold / 1000  # Normalize for relative coordinates
            
        except Exception:
            return False
    
    def _analyze_lighting(self, frame: np.ndarray) -> bool:
        """Analyze lighting conditions"""
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Calculate mean brightness
            mean_brightness = np.mean(gray)
            
            # Check for poor lighting (too dark or too bright)
            return mean_brightness < 50 or mean_brightness > 200
            
        except Exception:
            return False
    
    def reset_tracking(self):
        """Reset tracking data for new session"""
        self.prev_landmarks = None
        self.frame_count = 0

# Singleton instance
cheat_detector = CheatDetectionService()