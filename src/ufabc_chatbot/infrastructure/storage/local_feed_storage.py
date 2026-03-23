import asyncio
import json
from pathlib import Path
from typing import Any


class LocalFeedStorage:
    def __init__(self, root_dir: str | Path) -> None:
        self._root_dir = Path(root_dir).resolve()
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, stored_filename: str) -> Path:
        candidate = (self._root_dir / stored_filename).resolve()
        if not candidate.is_relative_to(self._root_dir):
            raise ValueError("Invalid stored filename path.")
        return candidate

    async def save(
        self,
        stored_filename: str,
        content: bytes,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        destination = self._resolve_path(stored_filename)
        destination.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(destination.write_bytes, content)
        if metadata:
            metadata_path = self._resolve_path(f"{stored_filename}.meta.json")
            metadata_path.parent.mkdir(parents=True, exist_ok=True)
            metadata_text = json.dumps(metadata, ensure_ascii=True, sort_keys=True)
            await asyncio.to_thread(metadata_path.write_text, metadata_text, "utf-8")

    async def read(self, stored_filename: str) -> bytes:
        source = self._resolve_path(stored_filename)
        if not source.exists():
            raise FileNotFoundError("Stored feed file content was not found.")

        return await asyncio.to_thread(source.read_bytes)

    async def delete(self, stored_filename: str) -> None:
        source = self._resolve_path(stored_filename)
        metadata_path = self._resolve_path(f"{stored_filename}.meta.json")

        def _delete_file(path: Path) -> None:
            if path.exists():
                path.unlink()

        await asyncio.to_thread(_delete_file, source)
        await asyncio.to_thread(_delete_file, metadata_path)

    async def move(self, source_stored_filename: str, target_stored_filename: str) -> None:
        source = self._resolve_path(source_stored_filename)
        target = self._resolve_path(target_stored_filename)
        source_meta = self._resolve_path(f"{source_stored_filename}.meta.json")
        target_meta = self._resolve_path(f"{target_stored_filename}.meta.json")

        if not source.exists():
            raise FileNotFoundError("Stored feed file content was not found.")

        target.parent.mkdir(parents=True, exist_ok=True)
        target_meta.parent.mkdir(parents=True, exist_ok=True)

        await asyncio.to_thread(source.replace, target)
        if source_meta.exists():
            await asyncio.to_thread(source_meta.replace, target_meta)

    async def delete_folder(self, folder_path: str) -> None:
        import shutil
        folder = self._resolve_path(folder_path)

        def _remove() -> None:
            if folder.exists():
                shutil.rmtree(folder)

        await asyncio.to_thread(_remove)

    async def create_folder(self, folder_path: str) -> None:
        folder = self._resolve_path(folder_path)
        folder.mkdir(parents=True, exist_ok=True)
        marker = self._resolve_path(f"{folder_path}/.folder")
        if not marker.exists():
            await asyncio.to_thread(marker.write_text, "", "utf-8")

    async def list_folders(self) -> list[str]:
        marker_paths = await asyncio.to_thread(list, self._root_dir.rglob(".folder"))
        folders: list[str] = []
        for marker in marker_paths:
            relative = marker.parent.relative_to(self._root_dir).as_posix()
            if relative != ".":
                folders.append(relative)
        return folders
