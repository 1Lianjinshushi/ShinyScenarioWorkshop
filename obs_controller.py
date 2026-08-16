from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import threading
import uuid
from dataclasses import dataclass
from typing import Any


class ObsWebSocketError(RuntimeError):
    """Base error for OBS WebSocket connection and protocol failures."""


class ObsAuthenticationError(ObsWebSocketError):
    """Raised when OBS requires a password or rejects the supplied password."""


@dataclass
class ObsRequestError(ObsWebSocketError):
    request_type: str
    code: int
    comment: str

    def __str__(self) -> str:
        detail = f"OBS request {self.request_type} failed ({self.code})"
        return f"{detail}: {self.comment}" if self.comment else detail


class ObsWebSocketClient:
    """Small dependency-free obs-websocket v5 client for the local exporter."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 4455,
        password: str = "",
        timeout: float = 8.0,
    ) -> None:
        self.host = str(host or "127.0.0.1")
        self.port = int(port)
        self.password = str(password or "")
        self.timeout = float(timeout)
        self.socket: socket.socket | None = None
        self._buffer = bytearray()
        self._lock = threading.RLock()
        self.hello: dict[str, Any] = {}
        self.negotiated_rpc_version = 0

    def connect(self) -> "ObsWebSocketClient":
        if self.socket is not None:
            return self
        if self.host not in {"127.0.0.1", "localhost", "::1"}:
            raise ObsWebSocketError("为保证安全，工坊只连接本机上的 OBS。")
        if not (1 <= self.port <= 65535):
            raise ObsWebSocketError("OBS WebSocket port must be between 1 and 65535")

        try:
            stream = socket.create_connection((self.host, self.port), timeout=self.timeout)
            stream.settimeout(self.timeout)
            self.socket = stream
            self._upgrade_websocket()
            hello_message = self._receive_json()
            if hello_message.get("op") != 0 or not isinstance(hello_message.get("d"), dict):
                raise ObsWebSocketError("OBS did not send a valid Hello message")
            self.hello = dict(hello_message["d"])
            identify_data: dict[str, Any] = {
                "rpcVersion": min(1, int(self.hello.get("rpcVersion") or 1)),
                "eventSubscriptions": 0,
            }
            authentication = self.hello.get("authentication")
            if isinstance(authentication, dict):
                if not self.password:
                    raise ObsAuthenticationError("OBS WebSocket 需要密码，请从 OBS 的“工具 → WebSocket 服务器设置”中复制。")
                identify_data["authentication"] = self._authentication_response(authentication)
            self._send_json({"op": 1, "d": identify_data})
            try:
                identified = self._receive_json()
            except ObsWebSocketError as error:
                if isinstance(authentication, dict):
                    raise ObsAuthenticationError("OBS WebSocket 密码不正确。") from error
                raise
            if identified.get("op") != 2 or not isinstance(identified.get("d"), dict):
                raise ObsAuthenticationError("OBS WebSocket 身份验证失败。")
            self.negotiated_rpc_version = int(identified["d"].get("negotiatedRpcVersion") or 1)
            return self
        except ObsWebSocketError:
            self.close()
            raise
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.close()
            raise ObsWebSocketError(f"Could not connect to OBS WebSocket: {error}") from error

    def close(self) -> None:
        stream, self.socket = self.socket, None
        if stream is None:
            return
        try:
            self._send_frame(b"", opcode=0x8, stream=stream)
        except Exception:
            pass
        try:
            stream.close()
        except OSError:
            pass
        self._buffer.clear()

    def request(self, request_type: str, request_data: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.socket is None:
            raise ObsWebSocketError("OBS WebSocket is not connected")
        request_id = uuid.uuid4().hex
        payload: dict[str, Any] = {
            "requestType": str(request_type),
            "requestId": request_id,
        }
        if request_data:
            payload["requestData"] = request_data
        with self._lock:
            self._send_json({"op": 6, "d": payload})
            while True:
                message = self._receive_json()
                if message.get("op") != 7:
                    continue
                data = message.get("d")
                if not isinstance(data, dict) or data.get("requestId") != request_id:
                    continue
                status = data.get("requestStatus")
                if not isinstance(status, dict):
                    raise ObsWebSocketError(f"OBS returned a malformed response to {request_type}")
                if not status.get("result"):
                    raise ObsRequestError(
                        str(request_type),
                        int(status.get("code") or 0),
                        str(status.get("comment") or ""),
                    )
                response_data = data.get("responseData")
                return dict(response_data) if isinstance(response_data, dict) else {}

    def __enter__(self) -> "ObsWebSocketClient":
        return self.connect()

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()

    def _upgrade_websocket(self) -> None:
        assert self.socket is not None
        websocket_key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            "GET / HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {websocket_key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "Sec-WebSocket-Protocol: obswebsocket.json\r\n"
            "\r\n"
        ).encode("ascii")
        self.socket.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = self.socket.recv(4096)
            if not chunk:
                raise ObsWebSocketError("OBS closed the connection during WebSocket setup")
            response.extend(chunk)
            if len(response) > 64 * 1024:
                raise ObsWebSocketError("OBS returned an oversized WebSocket handshake")
        header, remainder = bytes(response).split(b"\r\n\r\n", 1)
        lines = header.decode("iso-8859-1").split("\r\n")
        if not lines or " 101 " not in f" {lines[0]} ":
            raise ObsWebSocketError(f"OBS refused the WebSocket upgrade: {lines[0] if lines else 'empty response'}")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()
        expected_accept = base64.b64encode(hashlib.sha1(
            (websocket_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
        ).digest()).decode("ascii")
        if headers.get("sec-websocket-accept") != expected_accept:
            raise ObsWebSocketError("OBS returned an invalid WebSocket handshake")
        self._buffer.extend(remainder)

    def _authentication_response(self, authentication: dict[str, Any]) -> str:
        salt = str(authentication.get("salt") or "")
        challenge = str(authentication.get("challenge") or "")
        if not salt or not challenge:
            raise ObsAuthenticationError("OBS returned invalid authentication parameters")
        secret = base64.b64encode(hashlib.sha256(
            (self.password + salt).encode("utf-8")
        ).digest()).decode("ascii")
        return base64.b64encode(hashlib.sha256(
            (secret + challenge).encode("utf-8")
        ).digest()).decode("ascii")

    def _send_json(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._send_frame(encoded, opcode=0x1)

    def _send_frame(self, payload: bytes, opcode: int, stream: socket.socket | None = None) -> None:
        target = stream or self.socket
        if target is None:
            raise ObsWebSocketError("OBS WebSocket is not connected")
        mask = os.urandom(4)
        length = len(payload)
        frame = bytearray([0x80 | (opcode & 0x0F)])
        if length < 126:
            frame.append(0x80 | length)
        elif length <= 0xFFFF:
            frame.append(0x80 | 126)
            frame.extend(struct.pack("!H", length))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack("!Q", length))
        frame.extend(mask)
        frame.extend(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        target.sendall(frame)

    def _receive_json(self) -> dict[str, Any]:
        fragments = bytearray()
        text_opcode_seen = False
        while True:
            fin, opcode, payload = self._receive_frame()
            if opcode == 0x8:
                detail = payload[2:].decode("utf-8", errors="replace") if len(payload) >= 2 else ""
                raise ObsWebSocketError(f"OBS closed the WebSocket connection{': ' + detail if detail else ''}")
            if opcode == 0x9:
                self._send_frame(payload, opcode=0xA)
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x1:
                fragments = bytearray(payload)
                text_opcode_seen = True
            elif opcode == 0x0 and text_opcode_seen:
                fragments.extend(payload)
            else:
                continue
            if fin:
                value = json.loads(bytes(fragments).decode("utf-8"))
                if not isinstance(value, dict):
                    raise ObsWebSocketError("OBS sent a non-object JSON message")
                return value

    def _receive_frame(self) -> tuple[bool, int, bytes]:
        first, second = self._receive_exact(2)
        fin = bool(first & 0x80)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._receive_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._receive_exact(8))[0]
        if length > 64 * 1024 * 1024:
            raise ObsWebSocketError("OBS sent an oversized WebSocket frame")
        mask = self._receive_exact(4) if masked else b""
        payload = self._receive_exact(length)
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return fin, opcode, payload

    def _receive_exact(self, length: int) -> bytes:
        assert self.socket is not None
        while len(self._buffer) < length:
            chunk = self.socket.recv(max(4096, length - len(self._buffer)))
            if not chunk:
                raise ObsWebSocketError("OBS closed the WebSocket connection")
            self._buffer.extend(chunk)
        result = bytes(self._buffer[:length])
        del self._buffer[:length]
        return result


def probe_obs(host: str = "127.0.0.1", port: int = 4455, password: str = "") -> dict[str, Any]:
    with ObsWebSocketClient(host, port, password) as client:
        version = client.request("GetVersion")
        video = client.request("GetVideoSettings")
        record = client.request("GetRecordStatus")
        profiles = client.request("GetProfileList")
        record_directory = client.request("GetRecordDirectory")
        special_inputs = client.request("GetSpecialInputs")
        output_mode = client.request("GetProfileParameter", {
            "parameterCategory": "Output",
            "parameterName": "Mode",
        })
        mode = str(output_mode.get("parameterValue") or output_mode.get("defaultParameterValue") or "")
        encoder_category = "AdvOut" if mode.lower() == "advanced" else "SimpleOutput"
        encoder_name = "RecEncoder"
        encoder = client.request("GetProfileParameter", {
            "parameterCategory": encoder_category,
            "parameterName": encoder_name,
        })
        return {
            "connected": True,
            "authRequired": isinstance(client.hello.get("authentication"), dict),
            "obsVersion": version.get("obsVersion"),
            "obsWebSocketVersion": version.get("obsWebSocketVersion"),
            "rpcVersion": version.get("rpcVersion"),
            "video": video,
            "record": record,
            "profile": profiles.get("currentProfileName"),
            "recordDirectory": record_directory.get("recordDirectory"),
            "outputMode": mode,
            "recordEncoder": encoder.get("parameterValue") or encoder.get("defaultParameterValue"),
            "specialInputs": special_inputs,
        }
