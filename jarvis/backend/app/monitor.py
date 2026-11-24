"""Live system monitor: CPU, RAM, network throughput sampled once a second.

One background task samples psutil and fans the snapshot out to every
connected WebSocket.  Sampling happens in a worker thread so the event loop
never blocks, and nothing is sampled when nobody is connected.
"""

from __future__ import annotations

import asyncio
import platform
import time
from typing import Any, Awaitable, Callable

import psutil

Broadcast = Callable[[dict[str, Any]], Awaitable[None]]


class SystemMonitor:
    def __init__(self, broadcast: Broadcast, interval: float = 1.0) -> None:
        self._broadcast = broadcast
        self._interval = interval
        self._task: asyncio.Task[None] | None = None
        self._last_net: tuple[float, int, int] | None = None
        self.subscribers = 0
        self.last_snapshot: dict[str, Any] | None = None

    # -- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if self._task is None or self._task.done():
            psutil.cpu_percent(interval=None)  # prime the counter
            self._task = asyncio.create_task(self._run(), name="system-monitor")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # -- sampling --------------------------------------------------------
    def sample(self) -> dict[str, Any]:
        now = time.monotonic()
        vm = psutil.virtual_memory()
        net = psutil.net_io_counters()
        up_kbps = down_kbps = 0.0
        if self._last_net:
            t0, sent0, recv0 = self._last_net
            dt = max(now - t0, 1e-3)
            up_kbps = (net.bytes_sent - sent0) / dt / 1024
            down_kbps = (net.bytes_recv - recv0) / dt / 1024
        self._last_net = (now, net.bytes_sent, net.bytes_recv)
        try:
            disk = psutil.disk_usage("/" if platform.system() != "Windows" else "C:\\")
            disk_pct = disk.percent
        except Exception:
            disk_pct = None
        battery = None
        try:
            b = psutil.sensors_battery()
            if b:
                battery = {"percent": b.percent, "plugged": b.power_plugged}
        except Exception:
            pass
        snap = {
            "type": "monitor",
            "ts": time.time(),
            "cpu": psutil.cpu_percent(interval=None),
            "cpu_cores": psutil.cpu_count(logical=True),
            "ram": {
                "used_gb": round(vm.used / 2**30, 2),
                "total_gb": round(vm.total / 2**30, 2),
                "pct": vm.percent,
            },
            "net": {"up_kbps": round(up_kbps, 1), "down_kbps": round(down_kbps, 1)},
            "disk_pct": disk_pct,
            "battery": battery,
            "uptime_s": int(time.time() - psutil.boot_time()),
            "os": f"{platform.system()} {platform.release()}",
        }
        self.last_snapshot = snap
        return snap

    async def _run(self) -> None:
        while True:
            if self.subscribers > 0:
                snap = await asyncio.to_thread(self.sample)
                await self._broadcast(snap)
            await asyncio.sleep(self._interval)


def quick_status_text() -> str:
    """Human-readable one-liner used by the `system_status` tool."""
    vm = psutil.virtual_memory()
    cpu = psutil.cpu_percent(interval=0.2)
    return (
        f"CPU {cpu:.0f}% | RAM {vm.used / 2**30:.1f} GB / {vm.total / 2**30:.1f} GB "
        f"({vm.percent:.0f}%) | {platform.system()} {platform.release()}"
    )
