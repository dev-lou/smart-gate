import sys
import time

print("=== Face Recognition Installation Test ===")
print("\nStep 1: Testing library imports...")

try:
    import cv2
    import numpy as np
    import face_recognition
    print("✅ Success! All required libraries (cv2, face_recognition, numpy) imported correctly.")
except ImportError as e:
    print(f"❌ Error importing libraries: {e}")
    print("Please ensure you activate your virtual environment before running this script.")
    sys.exit(1)

def test_webcam_detection():
    print("\nStep 2: Initializing webcam...")
    # Initialize the webcam (index 0 is usually the default built-in laptop camera)
    video_capture = cv2.VideoCapture(0)
    
    if not video_capture.isOpened():
        print("⚠️  Warning: Could not open the webcam.")
        print("Skipping webcam tests. (Ensure no other app like Zoom/Teams is using the camera).")
        return

    print("✅ Webcam opened successfully. Capturing a single frame in 2 seconds...")
    # Sleep to allow the camera sensor to adjust to auto-exposure/lighting
    time.sleep(2)
    
    # Read a single frame from the camera
    ret, frame = video_capture.read()
    
    # Release the webcam immediately so the light turns off and it frees the resource
    video_capture.release()
    cv2.destroyAllWindows()
    
    if not ret or frame is None:
        print("❌ Error: Failed to grab a frame from the webcam.")
        return
        
    print("✅ Frame captured successfully!")
    
    print("\nStep 3: Processing the image for faces...")
    # Convert the image from BGR color (which OpenCV uses) to RGB color (which face_recognition requires)
    # Also ensure it is explicitly cast to standard unsigned 8-bit integers using numpy
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    rgb_frame = np.ascontiguousarray(rgb_frame, dtype=np.uint8)
    
    try:
        print("Scanning image for face locations...")
        # Detect the bounding boxes of any human faces in the image
        face_locations = face_recognition.face_locations(rgb_frame)
        num_faces = len(face_locations)
        print(f"Result: Detected {num_faces} face(s) in the camera frame!")
        
        if num_faces > 0:
            print("\nStep 4: Extracting face encodings...")
            # Extract the 128-dimensional embeddings for each detected face
            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
            
            for i, encoding in enumerate(face_encodings):
                print(f"\n--- Output for Face #{i+1} ---")
                print(f"Location Box (Top, Right, Bottom, Left): {face_locations[i]}")
                print(f"Total mathematical dimensions extracted: {len(encoding)}")
                # Print only the first 5 values out of 128 so we don't flood the screen
                print(f"First 5 encoding values: {encoding[:5]}")
            
            print("\n✅ Verification complete! The deep learning system is fully operational.")
        else:
            print("⚠️  No faces were found to encode. Please face the camera directly and well-lit, then try again.")
            
    except Exception as e:
        print(f"❌ An error occurred during face recognition processing: {e}")

if __name__ == "__main__":
    test_webcam_detection()
    print("\nTest script finished.")
