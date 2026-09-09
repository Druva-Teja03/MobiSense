import cv2
import json
from ultralytics import YOLO

model = YOLO("yolov8n.pt")

video_path = "traffic_vedio.mp4"
cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
frame_interval = int(fps)

vehicle_classes = ["car", "bus", "truck", "motorcycle"]
frame_count = 0
detections = []

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    if frame_count % frame_interval == 0:
        results = model.predict(frame, conf=0.3, verbose=False)
        vehicle_count = 0
        for r in results:
            for box in r.boxes:
                class_name = model.names[int(box.cls)]
                if class_name in vehicle_classes:
                    vehicle_count += 1

        if vehicle_count <= 5:
            level = "low"
        elif vehicle_count <= 15:
            level = "moderate"
        else:
            level = "heavy"

        detections.append({
            "id": f"video_traffic_{len(detections)+1:03d}",
            "type": "heavy_traffic",
            "vehicle_count": vehicle_count,
            "traffic_level": level,
            "frame_number": frame_count,
            "timestamp_in_video": round(frame_count / fps, 2)
        })

    frame_count += 1

cap.release()

print(f"Processed {frame_count} frames")
print(f"Total detections: {len(detections)}")
print(json.dumps(detections, indent=2))

with open("video_detections_traffic.json", "w") as f:
    json.dump(detections, f, indent=2)