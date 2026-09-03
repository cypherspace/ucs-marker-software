"""Storage abstraction — local filesystem (dev) or Google Cloud Storage (prod)."""
from __future__ import annotations

import os
import tempfile
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path


def _download_http(url: str) -> Path:
    """Download an HTTP/HTTPS URL to a temp file and return its path."""
    suffix = '.pdf' if '.pdf' in url.lower().split('?')[0] else '.bin'
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    urllib.request.urlretrieve(url, tmp.name)
    return Path(tmp.name)


class Storage(ABC):
    @abstractmethod
    def write(self, key: str, data: bytes) -> str:
        """Save data at key. Returns a URI (absolute path or gs://)."""

    @abstractmethod
    def localise_for_read(self, uri: str) -> Path:
        """Return a local Path for reading. Downloads from GCS if needed."""

    @abstractmethod
    def raw_uri(self, uri: str) -> str:
        """Return the raw URI as stored in the DB."""


# Repo root: services/extractor/pipeline/storage.py -> up 3 levels.
REPO_ROOT = Path(__file__).resolve().parents[3]


class LocalStorage(Storage):
    def __init__(self, root: str) -> None:
        # Anchor a relative STORAGE_DIR to the repo root, not the process cwd —
        # `npm run dev:extractor` cd's into services/extractor, which would
        # otherwise put clips somewhere the API cannot serve them.
        root_path = Path(root)
        if not root_path.is_absolute():
            root_path = (REPO_ROOT / root_path).resolve()
        self.root = root_path
        self.root.mkdir(parents=True, exist_ok=True)

    def write(self, key: str, data: bytes) -> str:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

    def localise_for_read(self, uri: str) -> Path:
        if uri.startswith(("https://", "http://")):
            return _download_http(uri)
        if uri.startswith("gs://"):
            raise ValueError("GCS URIs not supported in local mode")
        return Path(uri)

    def raw_uri(self, uri: str) -> str:
        return uri


class GcsStorage(Storage):
    def __init__(self, bucket_name: str) -> None:
        from google.cloud import storage as gcs
        self._bucket = gcs.Client().bucket(bucket_name)

    def write(self, key: str, data: bytes) -> str:
        self._bucket.blob(key).upload_from_string(data)
        return f"gs://{self._bucket.name}/{key}"

    def localise_for_read(self, uri: str) -> Path:
        if uri.startswith(("https://", "http://")):
            return _download_http(uri)
        if uri.startswith("gs://"):
            key = uri[len(f"gs://{self._bucket.name}/"):]
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(key).suffix)
            self._bucket.blob(key).download_to_filename(tmp.name)
            return Path(tmp.name)
        return Path(uri)

    def raw_uri(self, uri: str) -> str:
        return uri


def build_storage() -> Storage:
    backend = os.environ.get("STORAGE_BACKEND", "local")
    if backend == "gcs":
        bucket = os.environ.get("STORAGE_BUCKET")
        if not bucket:
            raise ValueError("STORAGE_BUCKET required when STORAGE_BACKEND=gcs")
        return GcsStorage(bucket)
    root = os.environ.get("STORAGE_DIR", "./storage")
    return LocalStorage(root)


storage: Storage = build_storage()
