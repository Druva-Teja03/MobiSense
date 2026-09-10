from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    job_title: str = Field(min_length=2, max_length=120)
    govt_id_number: str = Field(min_length=3, max_length=50)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class StatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(unresolved|in_progress|resolved)$")


class DetectionIngestRequest(BaseModel):
    type_key: str                     # 'pothole' | 'garbage' | 'heavy_traffic' | 'illegal_parking'
    lat: float
    lng: float
    detected_at: str                  # ISO timestamp, e.g. '2026-09-12T10:00:00Z'
    vehicle_count: Optional[int] = None
    traffic_level: Optional[str] = None
    item_count: Optional[int] = None
    severity: Optional[str] = None
    source_image: Optional[str] = None
