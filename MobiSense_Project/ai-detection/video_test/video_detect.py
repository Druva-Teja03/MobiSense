import cv2
import json
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

# Load pothole model
pothole_weights = hf_hub_download(repo_id="keremberke/yolov8m-pothole-segmentation", filename="best.pt")
pothole_model = YOLO(pothole_weights)

video_path = "pothole_vedio.mp4"
cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
frame_interval = int(fps)  # process 1 frame per second

frame_count = 0
detections = []

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    if frame_count % frame_interval == 0:
        results = pothole_model.predict(frame, conf=0.05, verbose=False)
        for r in results:
            if r.boxes is not None:
                for box in r.boxes:
                    detections.append({
                        "id": f"video_issue_{len(detections)+1:03d}",
                        "type": "pothole",
                        "confidence": float(box.conf),
                        "frame_number": frame_count,
                        "timestamp_in_video": round(frame_count / fps, 2)
                    })

    frame_count += 1
    
cap.release()
    

# Keep only the highest-confidence detection per second
best_per_timestamp = {}
for d in detections:
    ts = d["timestamp_in_video"]
    if ts not in best_per_timestamp or d["confidence"] > best_per_timestamp[ts]["confidence"]:
        best_per_timestamp[ts] = d

detections = list(best_per_timestamp.values())

print(f"Processed {frame_count} frames")
print(f"Total detections: {len(detections)}")

print(f"Processed {frame_count} frames")
print(f"Total detections: {len(detections)}")
print(json.dumps(detections, indent=2))

with open("video_detections.json", "w") as f:
    json.dump(detections, f, indent=2)