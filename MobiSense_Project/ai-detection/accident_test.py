"""
accident_test.py — heuristic road-accident flagging.

There's no off-the-shelf "accident" class in YOLOv8 — accident detection
normally needs a custom-trained model on crash footage, which is out of
scope for a first prototype. Instead, this uses a reasonable proxy signal
that's explainable in your SIH demo/report:

    Two or more vehicles whose bounding boxes overlap heavily (high IoU)
    in the same frame is treated as a CANDIDATE collision. The more the
    boxes overlap, the higher the reported severity.

This is a heuristic, not a certified accident classifier — false
positives are expected (e.g. genuinely bumper-to-bumper traffic can
trigger it). For the SIH round, swap this out for a properly trained
model if you get labeled crash-footage data; the rest of the pipeline
(dedup, alerting, dashboard) doesn't need to change either way — it
just reacts to whatever hits POST /detections with type_key='accident'.

Unlike garbage_test.py / traffic_test.py / pothole_test.py, this script
POSTS directly to the live backend instead of writing a JSON file —
accidents need the real-time alert in main.py to actually fire.
"""
import os
from datetime import datetime, timezone

import requests
from ultralytics import YOLO

API_URL = "http://localhost:8000/detections"

model = YOLO("yolov8n.pt")

image_folder = "accident_images"          # put test frames here
vehicle_classes = ["car", "bus", "truck", "motorcycle"]

# Camera location — replace with your actual camera's GPS coordinates.
CAMERA_LAT = 12.2958
CAMERA_LNG = 76.6394

IOU_CANDIDATE_THRESHOLD = 0.15   # boxes overlapping at least this much = worth flagging
IOU_MAJOR_THRESHOLD = 0.35       # heavier overlap = reported as more severe


def iou(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter_x1, inter_y1 = max(ax1, bx1), max(ay1, by1)
    inter_x2, inter_y2 = min(ax2, bx2), min(ay2, by2)
    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
    if inter_area == 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter_area / float(area_a + area_b - inter_area)


def classify_severity(max_iou: float) -> str:
    if max_iou >= IOU_MAJOR_THRESHOLD:
        return "major"
    return "minor"


def report_accident(vehicles_involved: int, severity: str, source_image: str):
    payload = {
        "type_key": "accident",
        "lat": CAMERA_LAT,
        "lng": CAMERA_LNG,
        "detected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vehicle_count": vehicles_involved,
        "severity": severity,
        "source_image": source_image,
    }
    try:
        res = requests.post(API_URL, json=payload, timeout=10)
        res.raise_for_status()
        data = res.json()
        merged = "merged into existing" if data["merged_into_existing"] else "NEW issue — alert triggered"
        print(f"  -> Reported to backend: {data['issue_code']} ({merged})")
    except requests.RequestException as e:
        print(f"  -> Could not reach backend at {API_URL}: {e}")
        print("     Is `uvicorn main:app --reload --port 8000` running?")


def main():
    if not os.path.isdir(image_folder):
        print(f"Create a folder named '{image_folder}' with test frames first.")
        return

    for filename in os.listdir(image_folder):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue

        image_path = os.path.join(image_folder, filename)
        results = model.predict(image_path, conf=0.3)

        vehicle_boxes = []
        for r in results:
            for box in r.boxes:
                class_name = model.names[int(box.cls)]
                if class_name in vehicle_classes:
                    vehicle_boxes.append(box.xyxy[0].tolist())

        max_overlap = 0.0
        overlapping_pair_count = 0
        for i in range(len(vehicle_boxes)):
            for j in range(i + 1, len(vehicle_boxes)):
                score = iou(vehicle_boxes[i], vehicle_boxes[j])
                if score >= IOU_CANDIDATE_THRESHOLD:
                    overlapping_pair_count += 1
                    max_overlap = max(max_overlap, score)

        print(f"{filename}: {len(vehicle_boxes)} vehicles detected, max overlap = {max_overlap:.2f}")

        if overlapping_pair_count > 0:
            severity = classify_severity(max_overlap)
            print(f"  -> CANDIDATE ACCIDENT (severity: {severity})")
            report_accident(vehicles_involved=overlapping_pair_count + 1, severity=severity, source_image=filename)


if __name__ == "__main__":
    main()
