import json, os
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

weights_path = hf_hub_download(repo_id="keremberke/yolov8m-pothole-segmentation", filename="best.pt")
model = YOLO(weights_path)

image_folder = "test_images"
all_pothole_data = []

for filename in os.listdir(image_folder):
    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
        results = model.predict(os.path.join(image_folder, filename), conf=0.2)
        count = sum(len(r.boxes) for r in results if r.boxes is not None)
        if count == 0:
            continue
        all_pothole_data.append({
            "type": "pothole", "lat": 12.2958, "lng": 76.6394,
            "severity": "high" if count > 2 else "moderate",
            "source_image": filename
        })

with open("detected_issues.json", "w") as f:
    json.dump(all_pothole_data, f, indent=2)