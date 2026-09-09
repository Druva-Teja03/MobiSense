import cv2
import json
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

weights_path = hf_hub_download(repo_id="esapzoi/litter-detection-yolov8", filename="best.pt")
model = YOLO(weights_path)

video_path = "garbage_vedio.webm"
cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
frame_interval = int(fps)

frame_count = 0
detections = []

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    if frame_count % frame_interval == 0:
        results = model.predict(frame, conf=0.2, verbose=False)
        item_count = 0
        for r in results:
            if r.boxes is not None:
                item_count = len(r.boxes)

        if item_count > 0:
            if item_count <= 2:
                severity = "low"
            elif item_count <= 5:
                severity = "moderate"
            else:
                severity = "high"

            detections.append({
                "id": f"video_garbage_{len(detections)+1:03d}",
                "type": "garbage",
                "item_count": item_count,
                "severity": severity,
                "frame_number": frame_count,
                "timestamp_in_video": round(frame_count / fps, 2)
            })

    frame_count += 1

cap.release()

print(f"Processed {frame_count} frames")
print(f"Total detections: {len(detections)}")
print(json.dumps(detections, indent=2))

with open("video_detections_garbage.json", "w") as f:
    json.dump(detections, f, indent=2)