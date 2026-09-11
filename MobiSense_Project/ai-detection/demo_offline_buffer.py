"""
demo_offline_buffer.py — a 30-second live demo for judges proving the
"local buffering when connectivity is unavailable" claim in the PPT.

HOW TO RUN THIS DEMO:
  1. Make sure the FastAPI backend is NOT running yet (or stop it).
  2. Run this script:  python demo_offline_buffer.py
     -> it will try to send 3 fake detections, fail each time (backend
        is down), and show them queuing up in offline_queue.json.
  3. In another terminal, start the backend:
        cd ../backend && uvicorn main:app --reload --port 8000
  4. Run this script again:  python demo_offline_buffer.py
     -> this time it flushes the 3 queued detections FIRST (in their
        original order/timestamps), then sends a 4th live detection.
  5. Show the dashboard/fleet page refreshing with all 4 incidents
     now present, despite 3 of them having been "detected" while the
     bus had no signal.

This mirrors exactly what a real bus would do: keep detecting potholes
on a route with no signal, then dump the whole backlog the moment it
passes a point with connectivity again.
"""
import time
from datetime import datetime, timedelta

from ingest_client import submit_detection, queue_length

# Three points along a fictional route, "detected" a few minutes apart,
# to show timestamps are preserved even though they're all sent at once
# once connectivity returns.
DEMO_ROUTE = [
    {"type_key": "pothole", "lat": 12.9720, "lng": 77.5950, "severity": "moderate", "vehicle_id": "BUS-014", "confidence": 0.82},
    {"type_key": "pothole", "lat": 12.9738, "lng": 77.5967, "severity": "high",     "vehicle_id": "BUS-014", "confidence": 0.88},
    {"type_key": "garbage", "lat": 12.9701, "lng": 77.5931, "severity": "low",      "vehicle_id": "BUS-014", "confidence": 0.76, "item_count": 2},
]


def main():
    print("=" * 70)
    print("MobiSense — Offline Buffering Demo")
    print("=" * 70)
    print(f"Current buffered queue length: {queue_length()}\n")

    base_time = datetime.utcnow() - timedelta(minutes=len(DEMO_ROUTE) * 3)
    for i, detection in enumerate(DEMO_ROUTE):
        payload = dict(detection)
        payload["detected_at"] = (base_time + timedelta(minutes=i * 3)).isoformat() + "Z"
        print(f"--- Detection {i + 1}/{len(DEMO_ROUTE)} ---")
        submit_detection(payload)
        time.sleep(0.5)

    print(f"\nFinal buffered queue length: {queue_length()}")
    if queue_length() == 0:
        print("All detections reached the backend — nothing is queued.")
    else:
        print("Detections are safely queued locally. Start the backend and "
              "re-run this script (or call flush_queue()) to send them.")


if __name__ == "__main__":
    main()
