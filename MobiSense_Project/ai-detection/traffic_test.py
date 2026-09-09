import json
import os
from ultralytics import YOLO

model = YOLO("yolov8n.pt")

image_folder = "traffic_images"
vehicle_classes = ["car", "bus", "truck", "motorcycle"]
all_traffic_data = []

for filename in os.listdir(image_folder):
    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
        image_path = os.path.join(image_folder, filename)
        results = model.predict(image_path, conf=0.3)

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

        all_traffic_data.append({
            "id": f"traffic_{len(all_traffic_data)+1:03d}",
            "type": "heavy_traffic",
            "lat": 12.2958,
            "lng": 76.6394,
            "vehicle_count": vehicle_count,
            "traffic_level": level,
            "timestamp": "2026-09-12T10:00:00Z",
            "status": "unresolved",
            "source_image": filename
        })

with open("detected_traffic.json", "w") as f:
    json.dump(all_traffic_data, f, indent=2)

print(f"Total traffic entries: {len(all_traffic_data)}")
print(json.dumps(all_traffic_data, indent=2))