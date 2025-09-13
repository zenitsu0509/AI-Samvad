import cv2
import numpy as np
from typing import Dict, Tuple, List
import base64
from PIL import Image
import io

class LightweightCheatDetection:
    """Lightweight computer vision service for cheat detection without MediaPipe"""
    
    def __init__(self):
        # Initialize OpenCV face cascade classifier
        try:
            # Try to load the cascade classifier
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
            self.cv_available = True
        except Exception as e:
            print(f"OpenCV cascades not available: {e}")
            self.cv_available = False
        
        # Thresholds
        self.movement_threshold = 30
        self.face_size_threshold = 50
        self.brightness_threshold = (30, 220)
        
        # Previous frame data
        self.prev_gray = None
        self.frame_count = 0
        self.prev_face_count = 0
        
    def analyze_frame(self, image_data: str) -> Dict:
        """
        Analyze frame for suspicious activities using basic OpenCV
        
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
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Initialize results
            results = {
                "suspicious_activity": False,
                "confidence": 0.0,
                "details": {
                    "face_detected": False,
                    "multiple_faces": False,
                    "face_too_small": False,
                    "unusual_movement": False,
                    "poor_lighting": False,
                    "frame_too_dark": False,
                    "frame_too_bright": False
                },
                "violations": [],
                "face_count": 0,
                "analysis_method": "opencv_basic"
            }
            
            if not self.cv_available:
                return self._basic_image_analysis(frame, results)
            
            # Face detection
            faces = self.face_cascade.detectMultiScale(
                gray, 
                scaleFactor=1.1, 
                minNeighbors=5, 
                minSize=(self.face_size_threshold, self.face_size_threshold)
            )
            
            face_count = len(faces)
            results["face_count"] = face_count
            
            if face_count > 0:
                results["details"]["face_detected"] = True
                
                # Check for multiple faces
                if face_count > 1:
                    results["details"]["multiple_faces"] = True
                    results["violations"].append(f"Multiple faces detected ({face_count})")
                    results["suspicious_activity"] = True
                
                # Check face size (too small might indicate looking away)
                for (x, y, w, h) in faces:
                    if w < self.face_size_threshold * 1.5 or h < self.face_size_threshold * 1.5:
                        results["details"]["face_too_small"] = True
                        results["violations"].append("Face appears too small (possibly far from camera)")
                        results["suspicious_activity"] = True
                        break
                
            else:
                results["violations"].append("No face detected")
                results["suspicious_activity"] = True
            
            # Movement detection
            if self.prev_gray is not None and self.frame_count > 2:
                movement_detected = self._detect_movement(gray)
                if movement_detected:
                    results["details"]["unusual_movement"] = True
                    results["violations"].append("Unusual movement detected")
                    results["suspicious_activity"] = True
            
            # Lighting analysis
            lighting_issues = self._analyze_lighting(gray)
            if lighting_issues:
                results["details"].update(lighting_issues["details"])
                results["violations"].extend(lighting_issues["violations"])
                if lighting_issues["suspicious"]:
                    results["suspicious_activity"] = True
            
            # Calculate confidence
            violation_count = len([v for v in results["details"].values() if v])
            total_checks = len(results["details"]) - 1  # Exclude analysis_method
            results["confidence"] = min(1.0, violation_count / total_checks if total_checks > 0 else 0)
            
            # Update tracking data
            self.prev_gray = gray.copy()
            self.prev_face_count = face_count
            self.frame_count += 1
            
            return results
            
        except Exception as e:
            return {
                "error": f"Frame analysis failed: {str(e)}",
                "suspicious_activity": False,
                "confidence": 0.0,
                "analysis_method": "error"
            }
    
    def _basic_image_analysis(self, frame: np.ndarray, results: Dict) -> Dict:
        """Basic image analysis when OpenCV cascades are not available"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Basic brightness analysis
            mean_brightness = np.mean(gray)
            
            if mean_brightness < self.brightness_threshold[0]:
                results["details"]["frame_too_dark"] = True
                results["violations"].append("Frame is too dark")
                results["suspicious_activity"] = True
            elif mean_brightness > self.brightness_threshold[1]:
                results["details"]["frame_too_bright"] = True
                results["violations"].append("Frame is too bright")
                results["suspicious_activity"] = True
            
            # Basic edge detection to estimate if there's a person
            edges = cv2.Canny(gray, 50, 150)
            edge_count = np.sum(edges > 0)
            
            # Rough estimate: if there are enough edges, assume person is present
            total_pixels = gray.shape[0] * gray.shape[1]
            edge_ratio = edge_count / total_pixels
            
            if edge_ratio > 0.05:  # Arbitrary threshold
                results["details"]["face_detected"] = True
            else:
                results["violations"].append("No person detected in frame")
                results["suspicious_activity"] = True
            
            results["analysis_method"] = "basic_opencv"
            results["confidence"] = 0.6  # Lower confidence for basic analysis
            
            return results
            
        except Exception as e:
            results["error"] = f"Basic analysis failed: {str(e)}"
            return results
    
    def _detect_movement(self, current_gray: np.ndarray) -> bool:
        """Detect significant movement between frames"""
        try:
            # Calculate absolute difference
            diff = cv2.absdiff(self.prev_gray, current_gray)
            
            # Threshold the difference
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            
            # Count non-zero pixels
            movement_pixels = cv2.countNonZero(thresh)
            total_pixels = current_gray.shape[0] * current_gray.shape[1]
            
            # Calculate movement percentage
            movement_percentage = (movement_pixels / total_pixels) * 100
            
            # Return True if movement is above threshold
            return movement_percentage > self.movement_threshold
            
        except Exception:
            return False
    
    def _analyze_lighting(self, gray: np.ndarray) -> Dict:
        """Analyze lighting conditions"""
        try:
            # Calculate statistics
            mean_brightness = np.mean(gray)
            std_brightness = np.std(gray)
            
            details = {}
            violations = []
            suspicious = False
            
            # Check brightness levels
            if mean_brightness < self.brightness_threshold[0]:
                details["poor_lighting"] = True
                details["frame_too_dark"] = True
                violations.append("Poor lighting - too dark")
                suspicious = True
            elif mean_brightness > self.brightness_threshold[1]:
                details["poor_lighting"] = True
                details["frame_too_bright"] = True
                violations.append("Poor lighting - too bright")
                suspicious = True
            
            # Check contrast (standard deviation of brightness)
            if std_brightness < 15:
                details["poor_lighting"] = True
                violations.append("Poor lighting - low contrast")
                suspicious = True
            
            return {
                "details": details,
                "violations": violations,
                "suspicious": suspicious,
                "stats": {
                    "mean_brightness": float(mean_brightness),
                    "std_brightness": float(std_brightness)
                }
            }
            
        except Exception:
            return {
                "details": {"poor_lighting": True},
                "violations": ["Lighting analysis failed"],
                "suspicious": False,
                "stats": {}
            }
    
    def reset_tracking(self):
        """Reset tracking data for new session"""
        self.prev_gray = None
        self.frame_count = 0
        self.prev_face_count = 0

# Singleton instance
lightweight_cheat_detector = LightweightCheatDetection()