"""Transcriptor local: uvicorn transcription_server:app --host 127.0.0.1 --port 3081.

El modelo se descarga en el primer inicio. No exponer este servicio a Internet.
"""
import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

app = FastAPI(docs_url=None, redoc_url=None)
model = WhisperModel(os.getenv("WHISPER_MODEL", "small"), device="cpu", compute_type="int8",
                     download_root=os.getenv("WHISPER_DOWNLOAD_ROOT") or None)
inference_lock = threading.Lock()
MAX_BYTES = 20 * 1024 * 1024


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), language: str = Form("es")):
    if language != "es":
        raise HTTPException(400, "Este servicio está configurado para reportes en español.")
    filename = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".ogg", prefix="mina-audio-", delete=False) as target:
            filename = Path(target.name)
            size = 0
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Audio demasiado grande.")
                target.write(chunk)
        if not size:
            raise HTTPException(400, "El audio está vacío.")
        with inference_lock:
            segments, _ = model.transcribe(str(filename), language="es", vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise HTTPException(422, "No se entendió el audio. Requiere revisión manual.")
        return {"text": text}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "No se pudo transcribir este audio.")
    finally:
        file.file.close()
        if filename is not None:
            filename.unlink(missing_ok=True)
