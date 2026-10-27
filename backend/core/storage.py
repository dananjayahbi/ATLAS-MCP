"""Storage router: UUID folder layout + atomic file writes (Doc 02 §8).

Contract highlights
-------------------
* Files are written **before** the row that references them (Doc 01 §11),
  so a row with a `relative_path` always points at a real file.
* Writes are atomic: temp file in the *same directory*, `fsync`, `os.replace`.
  `tempfile.NamedTemporaryFile` is deliberately not used — on Windows its
  delete-on-close handle blocks the rename.
* All public methods take/return POSIX-relative paths; absolute native paths
  are derived at response time only (Doc 01 §11 dual-path rule).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator

from django.conf import settings

from core.errors import StorageWriteFailed
from core.paths import resolve_under, to_absolute_native, to_posix_relative

CHUNK = 1024 * 1024


@dataclass(frozen=True)
class StoredFile:
    relative_path: str
    absolute_path: str
    filename: str
    byte_size: int
    sha256: str


def storage_root() -> Path:
    return Path(settings.ATLAS_STORAGE_ROOT).resolve()


def _sha256_of(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def atomic_write_bytes(absolute: Path, payload: bytes) -> None:
    """Write `payload` to `absolute` such that readers see all-or-nothing."""
    absolute.parent.mkdir(parents=True, exist_ok=True)
    # Unique temp name in the SAME directory => same volume => atomic replace.
    tmp = absolute.with_name(f".{absolute.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("wb") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, absolute)
    except OSError as exc:  # disk full, permissions, AV lock
        tmp.unlink(missing_ok=True)
        raise StorageWriteFailed(
            "Failed to write file atomically.",
            detail={"path": str(absolute), "reason": str(exc)},
        ) from exc


def atomic_write_stream(absolute: Path, stream: BinaryIO) -> None:
    absolute.parent.mkdir(parents=True, exist_ok=True)
    tmp = absolute.with_name(f".{absolute.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("wb") as fh:
            shutil.copyfileobj(stream, fh, CHUNK)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, absolute)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise StorageWriteFailed(
            "Failed to stream file atomically.",
            detail={"path": str(absolute), "reason": str(exc)},
        ) from exc


def append_line(absolute: Path, line: str) -> None:
    """Append a single line to a durable log (`execution.log`, `project_audit.log`)."""
    absolute.parent.mkdir(parents=True, exist_ok=True)
    with absolute.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(line if line.endswith("\n") else line + "\n")
        fh.flush()
        os.fsync(fh.fileno())


class StorageRouter:
    """Resolves and writes the per-project folder layout.

    ```
    storage/projects/{project_uuid}/
        meta.json
        project_audit.log
        tasks/{task_uuid}/
            meta.json
            input/    annotated_canvas.png, source_screenshot.png, context.md
            output/   git_patch.patch, test_execution.log, verification_*.png
            execution.log
    ```
    """

    # -- path builders -----------------------------------------------------
    def project_dir(self, project_uuid) -> Path:
        return storage_root() / "projects" / str(project_uuid)

    def task_dir(self, project_uuid, task_uuid) -> Path:
        return self.project_dir(project_uuid) / "tasks" / str(task_uuid)

    def task_input_dir(self, project_uuid, task_uuid) -> Path:
        return self.task_dir(project_uuid, task_uuid) / "input"

    def task_output_dir(self, project_uuid, task_uuid) -> Path:
        return self.task_dir(project_uuid, task_uuid) / "output"

    def audit_log_path(self, project_uuid) -> Path:
        return self.project_dir(project_uuid) / "project_audit.log"

    def execution_log_path(self, project_uuid, task_uuid) -> Path:
        return self.task_dir(project_uuid, task_uuid) / "execution.log"

    # -- scaffolding -------------------------------------------------------
    def scaffold_project(self, project_uuid) -> None:
        (self.project_dir(project_uuid) / "tasks").mkdir(parents=True, exist_ok=True)

    def scaffold_task(self, project_uuid, task_uuid) -> None:
        self.task_input_dir(project_uuid, task_uuid).mkdir(parents=True, exist_ok=True)
        self.task_output_dir(project_uuid, task_uuid).mkdir(parents=True, exist_ok=True)
        log = self.execution_log_path(project_uuid, task_uuid)
        if not log.exists():
            atomic_write_bytes(log, b"")

    # -- writes ------------------------------------------------------------
    def write_task_file(
        self,
        project_uuid,
        task_uuid,
        *,
        subdir: str,
        filename: str,
        payload: bytes,
    ) -> StoredFile:
        if subdir not in {"input", "output"}:
            raise ValueError(f"invalid task subdir: {subdir}")
        target = self.task_dir(project_uuid, task_uuid) / subdir / filename
        atomic_write_bytes(target, payload)
        sha, size = _sha256_of(target)
        return StoredFile(
            relative_path=to_posix_relative(target),
            absolute_path=str(target.resolve()),
            filename=filename,
            byte_size=size,
            sha256=sha,
        )

    def write_task_stream(
        self,
        project_uuid,
        task_uuid,
        *,
        subdir: str,
        filename: str,
        stream: BinaryIO,
    ) -> StoredFile:
        if subdir not in {"input", "output"}:
            raise ValueError(f"invalid task subdir: {subdir}")
        target = self.task_dir(project_uuid, task_uuid) / subdir / filename
        atomic_write_stream(target, stream)
        sha, size = _sha256_of(target)
        return StoredFile(
            relative_path=to_posix_relative(target),
            absolute_path=str(target.resolve()),
            filename=filename,
            byte_size=size,
            sha256=sha,
        )

    def copy_into_task(
        self,
        project_uuid,
        task_uuid,
        *,
        source_path: str,
        subdir: str,
        filename: str | None = None,
    ) -> StoredFile:
        """Copy an agent-supplied host path into the task folder.

        The source MUST already resolve inside the storage root (§14.3); agents
        cannot pull arbitrary host files into the archive.
        """
        source = resolve_under(source_path)
        if not source.is_file():
            raise StorageWriteFailed(
                "Source path is not a regular file.",
                detail={"path": source_path},
            )
        with source.open("rb") as fh:
            return self.write_task_stream(
                project_uuid,
                task_uuid,
                subdir=subdir,
                filename=filename or source.name,
                stream=fh,
            )

    def append_execution_log(self, project_uuid, task_uuid, line: str) -> None:
        append_line(self.execution_log_path(project_uuid, task_uuid), line)

    # -- reads -------------------------------------------------------------
    def open_task_file(self, relative_path: str) -> Path:
        absolute = resolve_under(relative_path)
        if not absolute.is_file():
            raise FileNotFoundError(str(absolute))
        return absolute

    def iter_task_file(self, relative_path: str) -> Iterator[bytes]:
        absolute = self.open_task_file(relative_path)
        with absolute.open("rb") as fh:
            for chunk in iter(lambda: fh.read(CHUNK), b""):
                yield chunk


def absolute_for(relative_path: str) -> str:
    return to_absolute_native(relative_path)


router = StorageRouter()
