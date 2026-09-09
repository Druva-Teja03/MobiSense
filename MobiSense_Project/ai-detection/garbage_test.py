import json
import os
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

weights_path = hf_hub_download(repo_id="esapzoi/litter-detection-yolov8", filename="best.pt")
model = YOLO(weights_path)

image_folder = "garbage_images"
all_garbage_data = []

for filename in os.listdir(image_folder):
    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
        image_path = os.path.join(image_folder, filename)
        results = model.predict(image_path, save=True, conf=0.2)

        item_count = 0
        for r in results:
            if r.boxes is not None:
                item_count = len(r.boxes)

        if item_count == 0:
            continue  # skip images with no detections

        if item_count <= 2:
            severity = "low"
        elif item_count <= 5:
            severity = "moderate"
        else:
            severity = "high"

        all_garbage_data.append({
            "id": f"garbage_{len(all_garbage_data)+1:03d}",
            "type": "garbage",
            "lat": 12.2958,
            "lng": 76.6394,
            "item_count": item_count,
            "severity": severity,
            "timestamp": "2026-09-12T10:00:00Z",
            "status": "unresolved",
            "source_image": filename
        })

with open("detected_garbage.json", "w") as f:
    json.dump(all_garbage_data, f, indent=2)

print(f"Total garbage locations: {len(all_garbage_data)}")
print(json.dumps(all_garbage_data, indent=2))