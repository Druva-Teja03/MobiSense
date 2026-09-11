"""
ingest_client.py — drop-in replacement for the `json.dump(...)` step at
the end of pothole_test.py / traffic_test.py / garbage_test.py.

Instead of writing to detected_*.json, call submit_detection(payload)
for each detection. It POSTs to the backend's /detections endpoint
(see backend/main.py), which runs the real spatial dedup logic.

OFFLINE BUFFERING (the feature this file exists to demonstrate):
A bus doesn't always have signal. If the POST fails for any
connection-related reason (backend down, no network, DNS failure,
timeout), the detection is NOT dropped — it's appended to a local
JSON queue file (offline_queue.json) with its original detected_at
timestamp preserved. The next time submit_detection() is called
successfully, or whenever flush_queue() is called explicitly, every
queued detection is sent in original chronological order before the
new one, so the backend's dedup engine still sees an accurate timeline
even though the events arrived late and out of real-time order.

Usage in a detection script:

    from ingest_client import submit_detection

    submit_detection({
        "type_key": "pothole",
        "lat": 12.3051,
        "lng": 76.6551,
        "detected_at": datetime.utcnow().isoformat() + "Z",
        "severity": "high",
        "source_image": filename,
        "vehicle_id": "BUS-014",
        "confidence": 0.87,
    })

That's it — queuing/flushing/retrying all happen inside this module.
"""
import json
import os
import time
import urllib.error
import urllib.request

API_BASE = os.getenv("MOBISENSE_API_BASE", "http://localhost:8000")
DETECTIONS_URL = f"{API_BASE}/detections"
QUEUE_FILE = os.path.join(os.path.dirname(__file__), "offline_queue.json")
REQUEST_TIMEOUT_S = 5


def _post(payload: dict) -> dict:
    """Raw POST to /detections. Raises on any network-level failure;
    lets HTTP-level errors (4xx/5xx) bubble up too, since those mean
    the backend IS reachable and the payload itself is the problem —
    retrying that later without fixing it would just fail again."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        DETECTIONS_URL, data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _load_queue() -> list:
    if not os.path.exists(QUEUE_FILE):
        return []
    try:
        with open(QUEUE_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def _save_queue(queue: list) -> None:
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=2)


def queue_length() -> int:
    return len(_load_queue())


def flush_queue(verbose: bool = True) -> dict:
    """Try to send every queued detection, oldest first. Stops at the
    first one that still fails (keeps ordering intact for next time)
    rather than skipping ahead and sending things out of order."""
    queue = _load_queue()
    if not queue:
        return {"sent": 0, "remaining": 0}

    sent = 0
    while queue:
        item = queue[0]
        try:
            result = _post(item)
            sent += 1
            queue.pop(0)
            if verbose:
                print(f"[QUEUE FLUSH] Sent buffered detection "
                      f"({item.get('type_key')} @ {item.get('detected_at')}) "
                      f"-> {result.get('issue_code')} "
                      f"({'merged' if result.get('merged_into_existing') else 'new issue'})")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if verbose:
                print(f"[QUEUE FLUSH] Still offline ({e}); "
                      f"{len(queue)} detection(s) remain queued.")
            break

    _save_queue(queue)
    return {"sent": sent, "remaining": len(queue)}


def submit_detection(payload: dict, verbose: bool = True) -> dict:
    """Main entry point. Flushes any older queued detections first (so
    ordering stays correct), then tries to send this one. On network
    failure, appends it to the queue instead of losing it."""
    flush_result = flush_queue(verbose=verbose)

    try:
        result = _post(payload)
        if verbose:
            print(f"[INGEST] {payload.get('type_key')} @ {payload.get('detected_at')} "
                  f"-> {result.get('issue_code')} "
                  f"({'merged' if result.get('merged_into_existing') else 'new issue'})")
        return {"status": "sent", "queued": False, **result}
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        queue = _load_queue()
        queue.append(payload)
        _save_queue(queue)
        if verbose:
            print(f"[INGEST] Backend unreachable ({e}) — buffered locally. "
                  f"{len(queue)} detection(s) now queued in {QUEUE_FILE}")
        return {"status": "queued", "queued": True, "queue_length": len(queue)}
